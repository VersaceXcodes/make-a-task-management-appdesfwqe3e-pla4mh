import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAppStore } from '@/store/main';

// --- Type Definitions (from OpenAPI and FRD) ---

interface ProjectSummary {
  id: string;
  project_name: string;
  project_key: string;
}

interface IssueMyAssignedResponseItem {
  id: string;
  issue_key: string;
  summary: string;
  issue_type: "Task" | "Bug" | "Story";
  status: "To Do" | "In Progress" | "Done";
  priority: "Highest" | "High" | "Medium" | "Low" | "Lowest";
  due_date: string | null; // ISO 8601 datetime string
  project: ProjectSummary;
}

type IssuesList = IssueMyAssignedResponseItem[];

type IssueStatus = "To Do" | "In Progress" | "Done";
type IssuePriority = "Highest" | "High" | "Medium" | "Low" | "Lowest";

// Define a union type for sortable column keys
type SortableColumnKey = 'project_name' | 'issue_key' | 'summary' | 'status' | 'priority' | 'due_date';

interface SortConfig {
  key: SortableColumnKey;
  direction: 'asc' | 'desc';
}

// --- Axios Instance (configured for general use) ---

const axios_instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
});

// --- Data Fetcher Function ---

const fetch_my_assigned_issues = async (
  status_filter: string[],
  priority_filter: string[],
  project_filter: string[],
  auth_token: string | null, // Added auth_token parameter
): Promise<IssueMyAssignedResponseItem[]> => {
  if (!auth_token) {
    // This should ideally be caught by `enabled` in useQuery, but good for type safety
    throw new Error('Authentication token is missing.');
  }

  const params: Record<string, string | string[]> = {};
  if (status_filter.length > 0) params.status = status_filter;
  if (priority_filter.length > 0) params.priority = priority_filter;
  if (project_filter.length > 0) params.project_id = project_filter;

  const { data } = await axios_instance.get<IssueMyAssignedResponseItem[]>( // Use configured axios_instance
    `/api/v1/users/me/assigned_issues`,
    {
      params,
      headers: {
        Authorization: `Bearer ${auth_token}`, // Add authorization header
      },
    }
  );
  return data;
};

const UV_MyWorkDashboard: React.FC = () => {
  const { auth_token, my_projects, set_global_loading, add_snackbar_message } = useAppStore();
  const [search_params] = useSearchParams();

  // --- State variables for filters ---
  const [selected_status_filter, set_selected_status_filter] = useState<IssueStatus[]>([]);
  const [selected_priority_filter, set_selected_priority_filter] = useState<IssuePriority[]>([]);
  const [selected_project_filter, set_selected_project_filter] = useState<string[]>([]);
  const [search_query_input, set_search_query_input] = useState<string>('');

  // --- State for table sorting ---
  const [sort_config, set_sort_config] = useState<SortConfig>({ key: 'due_date', direction: 'asc' });

  // --- Initialize filters from URL parameters on mount ---
  useEffect(() => {
    const url_status = search_params.getAll('status') as IssueStatus[];
    if (url_status.length > 0) set_selected_status_filter(url_status);

    const url_priority = search_params.getAll('priority') as IssuePriority[];
    if (url_priority.length > 0) set_selected_priority_filter(url_priority);

    const url_project_id = search_params.getAll('project_id');
    if (url_project_id.length > 0) set_selected_project_filter(url_project_id);
  }, [search_params]);

  // --- React Query for fetching assigned issues ---
  const { data: fetched_issues, isLoading, isError, error } = useQuery<IssuesList, Error>({
    queryKey: ['my_assigned_issues', selected_status_filter, selected_priority_filter, selected_project_filter, auth_token],
    queryFn: () => fetch_my_assigned_issues(selected_status_filter, selected_priority_filter, selected_project_filter, auth_token),
    enabled: !!auth_token, // Only fetch if auth_token is available
    onSuccess: () => {
      set_global_loading(false);
    },
    onError: (err) => {
      console.error('Failed to fetch assigned issues:', err);
      add_snackbar_message('error', `Failed to load assigned tasks: ${err.message}`);
      set_global_loading(false);
    },
    // Keep previous data while fetching new, for better UX during filter changes
    keepPreviousData: true,
  });

  // Set global loading indicator
  useEffect(() => {
    set_global_loading(isLoading);
  }, [isLoading, set_global_loading]);

  // --- Filter and Sort logic (client-side) ---
  const filtered_and_sorted_issues = useMemo(() => {
    if (!fetched_issues) return [];

    let temp_issues = fetched_issues;

    // Apply client-side search query input filter
    if (search_query_input) {
      const lower_case_query = search_query_input.toLowerCase();
      temp_issues = temp_issues.filter(issue =>
        issue.issue_key.toLowerCase().includes(lower_case_query) ||
        issue.summary.toLowerCase().includes(lower_case_query)
      );
    }

    // Apply sorting
    return [...temp_issues].sort((a, b) => {
      let a_val: any;
      let b_val: any;

      if (sort_config.key === 'project_name') {
        a_val = a.project.project_name;
        b_val = b.project.project_name;
      } else {
        a_val = a[sort_config.key];
        b_val = b[sort_config.key];
      }

      // Handle nulls for due_date (nulls last for ASC, nulls first for DESC)
      if (sort_config.key === 'due_date') {
        if (a_val === null && b_val === null) return 0;
        if (a_val === null) return sort_config.direction === 'asc' ? 1 : -1;
        if (b_val === null) return sort_config.direction === 'asc' ? -1 : 1;
      }

      // Basic comparison for other types, assuming they are comparable strings/numbers
      if (a_val < b_val) return sort_config.direction === 'asc' ? -1 : 1;
      if (a_val > b_val) return sort_config.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [fetched_issues, search_query_input, sort_config]);

  // --- Handlers ---
  // Refined filter change handlers for 'All' option consistency
  const handle_filter_change = useCallback(<T extends string>(setter: React.Dispatch<React.SetStateAction<T[]>>, isProjectFilter: boolean = false) =>
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const values = Array.from(e.target.selectedOptions, option => option.value) as T[];

      if (values.includes('All')) {
        if (values.length === 1) {
          setter([]); // If only 'All' is selected, clear filters
        } else {
          // If 'All' is selected with other options, filter out 'All'
          setter(values.filter(s => s !== 'All') as T[]);
        }
      } else if (values.length === 0 && !isProjectFilter) {
        // This case handles when all specific options are unselected without 'All' being an option clicked.
        // For a multiple select, if nothing is selected, it typically sends an empty array.
        // So if the user explicitly unselects all, we consider it 'All'.
        setter([]);
      } else {
        setter(values);
      }
    },
    [],
  );

  const handle_status_filter_change = handle_filter_change(set_selected_status_filter);
  const handle_priority_filter_change = handle_filter_change(set_selected_priority_filter);
  const handle_project_filter_change = handle_filter_change(set_selected_project_filter, true);

  const handle_search_input_change = (e: React.ChangeEvent<HTMLInputElement>) => {
    set_search_query_input(e.target.value);
  };

  const handle_sort_click = (key: SortableColumnKey) => {
    set_sort_config(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const get_sort_indicator = (
    key: SortableColumnKey
  ) => {
    if (sort_config.key === key) {
      return sort_config.direction === 'asc' ? ' ▲' : ' ▼';
    }
    return '';
  };

  const format_date = (date_string: string | null) => {
    if (!date_string) return 'N/A';
    try {
      return new Date(date_string).toLocaleDateString();
    } catch (e) {
      console.error('Error formatting date:', e);
      return 'Invalid Date';
    }
  };

  const available_status_options: (IssueStatus | 'All')[] = ['All', 'To Do', 'In Progress', 'Done'];
  const available_priority_options: (IssuePriority | 'All')[] = ['All', 'Highest', 'High', 'Medium', 'Low', 'Lowest'];

  return (
    <div className="container mx-auto p-6 bg-white shadow-lg rounded-lg">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">My Assigned Tasks</h1>

      {/* Filtering Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Status Filter */}
        <div>
          <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-1">
            Status:
          </label>
          <select
            id="status-filter"
            multiple
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm"
            value={selected_status_filter.length === 0 ? ['All'] : selected_status_filter}
            onChange={handle_status_filter_change}
          >
            {available_status_options.map(status => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        {/* Priority Filter */}
        <div>
          <label htmlFor="priority-filter" className="block text-sm font-medium text-gray-700 mb-1">
            Priority:
          </label>
          <select
            id="priority-filter"
            multiple
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm"
            value={selected_priority_filter.length === 0 ? ['All'] : selected_priority_filter}
            onChange={handle_priority_filter_change}
          >
            {available_priority_options.map(priority => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>

        {/* Project Filter */}
        <div>
          <label htmlFor="project-filter" className="block text-sm font-medium text-gray-700 mb-1">
            Project:
          </label>
          <select
            id="project-filter"
            multiple
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm"
            value={selected_project_filter.length === 0 ? ['All'] : selected_project_filter}
            onChange={handle_project_filter_change}
          >
            <option value="All">All Projects</option>
            {my_projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.project_name} ({project.project_key})
              </option>
            ))}
          </select>
        </div>

        {/* Search Bar */}
        <div>
          <label htmlFor="search-input" className="block text-sm font-medium text-gray-700 mb-1">
            Search by Key or Summary:
          </label>
          <input
            type="text"
            id="search-input"
            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2"
            placeholder="e.g., WEB-123 or login bug"
            value={search_query_input}
            onChange={handle_search_input_change}
          />
        </div>
      </div>

      {/* Content Area: Loading, Error, No Data, or Table */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="text-gray-600 mt-4">Loading your assigned tasks...</p>
        </div>
      ) : isError ? (
        <div className="text-center py-8 text-red-600">
          <p className="font-semibold">Error:</p>
          <p>{error?.message || 'Failed to fetch tasks.'}</p>
          <p className="text-sm text-gray-500 mt-2">Please try refreshing the page.</p>
        </div>
      ) : filtered_and_sorted_issues.length === 0 ? (
        <div className="text-center py-8 text-gray-600">
          <p className="text-lg font-medium">No assigned tasks found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg shadow-md">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_click('project_name')}
                >
                  Project Name {get_sort_indicator('project_name')}
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_click('issue_key')}
                >
                  Issue Key {get_sort_indicator('issue_key')}
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_click('summary')}
                >
                  Summary {get_sort_indicator('summary')}
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_click('status')}
                >
                  Status {get_sort_indicator('status')}
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_click('priority')}
                >
                  Priority {get_sort_indicator('priority')}
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_click('due_date')}
                >
                  Due Date {get_sort_indicator('due_date')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered_and_sorted_issues.map(issue => (
                <tr key={issue.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {issue.project.project_name} ({issue.project.project_key})
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Link to={`/issues/${issue.issue_key}`} className="text-blue-600 hover:text-blue-800">
                      {issue.issue_key}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 overflow-hidden text-ellipsis max-w-xs">
                    {issue.summary}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {issue.status}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {issue.priority}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {format_date(issue.due_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UV_MyWorkDashboard;