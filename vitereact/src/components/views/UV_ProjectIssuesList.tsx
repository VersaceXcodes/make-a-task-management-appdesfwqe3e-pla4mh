import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAppStore } from '@/store/main';

// --- Type Definitions (from app:architecture and OpenAPI) ---

// Re-declare necessary interfaces from global store if they are not globally exported (as they are in store/main.tsx)
// If store/main.tsx exports these, they can be imported directly. Assuming for this component, they are "re-defined" locally
// or imported. Given the prompt wants all types used here, I will define them here.
interface UserSummary {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

interface ProjectSummary {
  id: string;
  project_name: string;
  project_key: string;
}

interface IssueListResponseItem {
  id: string;
  issue_key: string;
  summary: string;
  issue_type: 'Task' | 'Bug' | 'Story';
  status: 'To Do' | 'In Progress' | 'Done';
  assignee: UserSummary | null;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  due_date: string | null; // ISO 8601 datetime
  reporter: UserSummary;
  last_updated_at: string; // ISO 8601 datetime
  rank: number;
}

interface ProjectMemberResponse { // From OpenAPI /api/v1/projects/:project_id/members
  id: string;
  user_id: string;
  project_id: string;
  role: 'Admin' | 'Member';
  user_details: UserSummary; // This is actually UserResponse in OpenAPI, but UserSummary contains relevant fields
  created_at: string;
  updated_at: string;
}

// CurrentFilters from the PRD/FRD
interface CurrentFilters {
  issue_type?: ('Task' | 'Bug' | 'Story')[];
  status?: ('To Do' | 'In Progress' | 'Done')[];
  assignee_id?: string[];
  reporter_id?: string[];
  priority?: ('Highest' | 'High' | 'Medium' | 'Low' | 'Lowest')[];
  labels?: string[];
  search_query?: string;
}

type SortOrder = 'asc' | 'desc';

// --- Constants / Enums for UI ---
const ISSUE_TYPES: ('Task' | 'Bug' | 'Story')[] = ['Task', 'Bug', 'Story'];
const ISSUE_STATUSES: ('To Do' | 'In Progress' | 'Done')[] = ['To Do', 'In Progress', 'Done'];
const ISSUE_PRIORITIES: ('Highest' | 'High' | 'Medium' | 'Low' | 'Lowest')[] = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

// Hardcoded labels due to OpenAPI mismatch (IssueListResponseItem does not return labels, and no dedicated API for project labels)
const AVAILABLE_LABELS_MOCK: string[] = ['feature', 'bugfix', 'critical', 'design', 'backend', 'frontend', 'testing', 'documentation'];

// Map priority to Tailwind CSS color classes for visual distinction
const PRIORITY_COLORS: Record<IssueListResponseItem['priority'], string> = {
  'Highest': 'bg-red-200 text-red-800',
  'High': 'bg-orange-200 text-orange-800',
  'Medium': 'bg-yellow-200 text-yellow-800',
  'Low': 'bg-green-200 text-green-800',
  'Lowest': 'bg-blue-200 text-blue-800',
};

// Map issue type to icon/color (conceptual without actual icon library, just colors)
const ISSUE_TYPE_COLORS: Record<IssueListResponseItem['issue_type'], string> = {
  'Task': 'bg-gray-500 text-white',
  'Bug': 'bg-red-500 text-white',
  'Story': 'bg-purple-500 text-white',
};

// API Base URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// --- API Call Functions (used by React Query hooks) ---

interface GetIssuesListParams extends CurrentFilters {
  project_id: string;
  sort_by: string;
  sort_order: string;
}

const fetch_project_issues_list = async (params: GetIssuesListParams): Promise<IssueListResponseItem[]> => {
  const query_params = new URLSearchParams();
  if (params.issue_type && params.issue_type.length > 0) query_params.append('issue_type', params.issue_type.join(','));
  if (params.status && params.status.length > 0) query_params.append('status', params.status.join(','));
  if (params.assignee_id && params.assignee_id.length > 0) query_params.append('assignee_id', params.assignee_id.join(','));
  if (params.reporter_id && params.reporter_id.length > 0) query_params.append('reporter_id', params.reporter_id.join(','));
  if (params.priority && params.priority.length > 0) query_params.append('priority', params.priority.join(','));
  if (params.labels && params.labels.length > 0) query_params.append('labels', params.labels.join(','));
  if (params.search_query) query_params.append('search_query', params.search_query);
  query_params.append('sort_by', params.sort_by);
  query_params.append('sort_order', params.sort_order);

  const { data } = await axios.get<IssueListResponseItem[]>(`${API_BASE_URL}/api/v1/projects/${params.project_id}/issues?${query_params.toString()}`);
  return data;
};

const fetch_project_members = async (project_id: string): Promise<UserSummary[]> => {
  const { data } = await axios.get<ProjectMemberResponse[]>(`${API_BASE_URL}/api/v1/projects/${project_id}/members`);
  // Map ProjectMemberResponse to UserSummary as required by UI components
  return data.map(member => member.user_details);
};

const update_issue_rank_api = async (issue_id: string, new_rank: number): Promise<{ id: string; rank: number }> => {
  const { data } = await axios.put<{ id: string; rank: number }>(`${API_BASE_URL}/api/v1/issues/${issue_id}/rank`, { new_rank });
  return data;
};

// --- UV_ProjectIssuesList Component ---
const UV_ProjectIssuesList: React.FC = () => {
  const query_client = useQueryClient();
  const { project_key = '' } = useParams<{ project_key: string }>();
  const [search_params, set_search_params] = useSearchParams();
  const navigate = useNavigate();

  const { authenticated_user, my_projects, add_snackbar_message } = useAppStore();

  // Derive project_id and project_name from global state
  const project = useMemo(() => my_projects.find(p => p.project_key === project_key), [my_projects, project_key]);
  const project_id = project?.id;
  const project_name = project?.project_name;

  // --- State Management for Filters, Search, and Sorting ---
  // Helper to parse URL search parameters into array format
  const get_url_param_array = useCallback((param_name: string): string[] => {
    const param = search_params.get(param_name);
    return param ? param.split(',') : [];
  }, [search_params]);

  // Helper to parse URL search parameters into single string format
  const get_url_param_single = useCallback((param_name: string, default_value: string = ''): string => {
    return search_params.get(param_name) || default_value;
  }, [search_params]);

  // Initialize state from URL params
  const [current_filters, set_current_filters] = useState<CurrentFilters>(() => ({
    issue_type: get_url_param_array('issue_type') as ('Task' | 'Bug' | 'Story')[],
    status: get_url_param_array('status') as ('To Do' | 'In Progress' | 'Done')[],
    assignee_id: get_url_param_array('assignee_id'),
    reporter_id: get_url_param_array('reporter_id'),
    priority: get_url_param_array('priority') as ('Highest' | 'High' | 'Medium' | 'Low' | 'Lowest')[],
    labels: get_url_param_array('labels'),
    search_query: get_url_param_single('search_query'),
  }));
  const [search_query_input_value, set_search_query_input_value] = useState<string>(() => get_url_param_single('search_query'));
  const [current_sort_by, set_current_sort_by] = useState<string>(() => get_url_param_single('sort_by', 'rank'));
  const [current_sort_order, set_current_sort_order] = useState<SortOrder>(() => get_url_param_single('sort_order', 'asc') as SortOrder);

  // Effect to re-sync local state when URL params change (e.g., browser back/forward, programmatic navigation)
  useEffect(() => {
    set_current_filters({
      issue_type: get_url_param_array('issue_type') as ('Task' | 'Bug' | 'Story')[],
      status: get_url_param_array('status') as ('To Do' | 'In Progress' | 'Done')[],
      assignee_id: get_url_param_array('assignee_id'),
      reporter_id: get_url_param_array('reporter_id'),
      priority: get_url_param_array('priority') as ('Highest' | 'High' | 'Medium' | 'Low' | 'Lowest')[],
      labels: get_url_param_array('labels'),
      search_query: get_url_param_single('search_query'),
    });
    set_search_query_input_value(get_url_param_single('search_query'));
    set_current_sort_by(get_url_param_single('sort_by', 'rank'));
    set_current_sort_order(get_url_param_single('sort_order', 'asc') as SortOrder);
  }, [search_params, get_url_param_array, get_url_param_single]);

  // --- Helper to apply filters/sort/search to URL and trigger data fetch ---
  const apply_filters_to_url = useCallback((
    new_filters: CurrentFilters,
    new_sort_by: string,
    new_sort_order: SortOrder,
    new_search_query: string
  ) => {
    const params = new URLSearchParams();
    if (new_filters.issue_type && new_filters.issue_type.length > 0) params.set('issue_type', new_filters.issue_type.join(','));
    if (new_filters.status && new_filters.status.length > 0) params.set('status', new_filters.status.join(','));
    if (new_filters.assignee_id && new_filters.assignee_id.length > 0) params.set('assignee_id', new_filters.assignee_id.join(','));
    if (new_filters.reporter_id && new_filters.reporter_id.length > 0) params.set('reporter_id', new_filters.reporter_id.join(','));
    if (new_filters.priority && new_filters.priority.length > 0) params.set('priority', new_filters.priority.join(','));
    if (new_filters.labels && new_filters.labels.length > 0) params.set('labels', new_filters.labels.join(','));
    if (new_search_query) params.set('search_query', new_search_query);

    // Only add sort parameters if they are not the default ('rank', 'asc')
    if (new_sort_by !== 'rank' || new_sort_order !== 'asc') {
      params.set('sort_by', new_sort_by);
      params.set('sort_order', new_sort_order);
    }

    set_search_params(params, { replace: true }); // Use replace to avoid polluting history stack
  }, [set_search_params]);

  // --- Event Handlers for UI filtering/sorting ---
  const handle_filter_change = useCallback((
    key: keyof CurrentFilters,
    value: string | string[]
  ) => {
    const updated_filters: CurrentFilters = { ...current_filters };
    if (Array.isArray(value)) {
      // For multi-selects, ensure 'All' or empty selections reset the filter
      updated_filters[key] = value.length > 0 ? value : undefined;
    } else {
      // This path is for single value filtering (not applicable for current FRD's multi-select filters, but good for robust future use)
    }
    set_current_filters(updated_filters);
    apply_filters_to_url(updated_filters, current_sort_by, current_sort_order, search_query_input_value);
  }, [current_filters, apply_filters_to_url, current_sort_by, current_sort_order, search_query_input_value]);

  const handle_search_submit = useCallback(() => {
    apply_filters_to_url(current_filters, current_sort_by, current_sort_order, search_query_input_value);
  }, [current_filters, current_sort_by, current_sort_order, search_query_input_value, apply_filters_to_url]);

  const handle_sort_change = useCallback((column: string) => {
    // Check if the column is supported for sorting by the backend API
    const supported_sort_columns = ['rank', 'summary', 'issue_type', 'status', 'assignee', 'priority', 'due_date', 'reporter', 'last_updated_at'];
    if (!supported_sort_columns.includes(column)) {
      // Optionally, add a snackbar message here to inform the user it's not sortable
      add_snackbar_message('warning', `Sorting by '${column}' is not supported.`);
      return;
    }

    let new_sort_order: SortOrder = 'asc';
    if (current_sort_by === column) {
      new_sort_order = current_sort_order === 'asc' ? 'desc' : 'asc';
    }
    set_current_sort_by(column);
    set_current_sort_order(new_sort_order);
    apply_filters_to_url(current_filters, column, new_sort_order, search_query_input_value);
  }, [current_sort_by, current_sort_order, current_filters, search_query_input_value, apply_filters_to_url, add_snackbar_message]);

  const clear_all_filters = useCallback(() => {
    set_current_filters({});
    set_search_query_input_value('');
    set_current_sort_by('rank');
    set_current_sort_order('asc');
    set_search_params(new URLSearchParams(), { replace: true });
  }, [set_search_params]);

  // --- Data Fetching with React Query ---

  // Fetch project members for filter dropdowns
  const { data: project_members_list = [], isLoading: members_loading, isError: members_error, error: members_fetch_error } = useQuery<UserSummary[], Error>({
    queryKey: ['projectMembers', project_id],
    queryFn: () => fetch_project_members(project_id!),
    enabled: !!project_id, // Only fetch if project_id is defined
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Fetch issues list based on current filters and sort
  const { data: issues_list = [], isLoading: issues_loading, isError: issues_error, error: issues_fetch_error } = useQuery<IssueListResponseItem[], Error>({
    queryKey: ['projectIssues', project_id, current_filters, current_sort_by, current_sort_order, search_query_input_value],
    queryFn: () => fetch_project_issues_list({
      project_id: project_id!,
      ...current_filters,
      search_query: current_filters.search_query || '', // Ensure search_query is treated as string, not undefined
      sort_by: current_sort_by,
      sort_order: current_sort_order,
    }),
    enabled: !!project_id, // Only fetch if project_id is defined
    staleTime: 1000 * 30, // Shorter cache for issues, as they can change frequently
  });

  useEffect(() => {
    if (issues_fetch_error) {
      add_snackbar_message('error', `Failed to load issues: ${issues_fetch_error.message}`);
    }
    if (members_fetch_error) {
      add_snackbar_message('error', `Failed to load project members: ${members_fetch_error.message}`);
    }
  }, [issues_fetch_error, members_fetch_error, add_snackbar_message]);

  // --- Mutation for updating Issue Rank (Drag and Drop) ---
  const update_rank_mutation = useMutation<
    { id: string; rank: number },
    Error,
    { issue_id: string; new_rank: number }
  >({
    mutationFn: ({ issue_id, new_rank }) => update_issue_rank_api(issue_id, new_rank),
    onMutate: async (newRankData) => {
      // Optimistic update: cancel ongoing fetches and update local cache
      await query_client.cancelQueries({ queryKey: ['projectIssues', project_id, current_filters, current_sort_by, current_sort_order, search_query_input_value] });
      const previous_issues = query_client.getQueryData<IssueListResponseItem[]>(['projectIssues', project_id, current_filters, current_sort_by, current_sort_order, search_query_input_value]);

      // Update the issue's rank directly in the cached data, and then re-sort if necessary
      const updated_list = (previous_issues || []).map(issue =>
        issue.id === newRankData.issue_id ? { ...issue, rank: newRankData.new_rank } : issue
      );

      // Re-sort the updated list visually for correctness, but only if sorting by rank
      const sorted_updated_list = current_sort_by === 'rank' ? [...updated_list].sort((a, b) => a.rank - b.rank) : updated_list;

      query_client.setQueryData(['projectIssues', project_id, current_filters, current_sort_by, current_sort_order, search_query_input_value], sorted_updated_list);

      return { previous_issues }; // Context for onError
    },
    onError: (err, newRankData, context) => {
      // Revert to previous state on error
      if (context?.previous_issues) {
        query_client.setQueryData(['projectIssues', project_id, current_filters, current_sort_by, current_sort_order, search_query_input_value], context.previous_issues);
      }
      add_snackbar_message('error', `Failed to update issue rank: ${err.message}`);
    },
    onSuccess: (data) => {
      // Invalidate and refetch to ensure the canonical backend order is displayed
      // This also implicitly handles cases where the backend's final rank differs slightly due to its own rounding/logic.
      query_client.invalidateQueries({ queryKey: ['projectIssues', project_id, current_filters, current_sort_by, current_sort_order, search_query_input_value] });
      add_snackbar_message('success', `Issue ${data.id} rank updated successfully.`);
    },
  });

  // --- Drag and Drop Logic (Conceptual, as a DND library would provide the actual events) ---
  // This function would be triggered by an external DND library's 'onDragEnd' event.
  // It simulates how to trigger the rank update mutation.
  const handle_row_reorder_conceptual = useCallback((dragged_item_id: string, new_position_index: number) => {
    // This is a highly simplified rank calculation for demonstration.
    // Real-world DND libraries (like react-beautiful-dnd or dnd-kit) provide the reordered list
    // and often require a more robust rank interpolation algorithm (e.g., "lexorank" or similar)
    // if the backend stores explicit ranks.
    if (!issues_list || issues_list.length === 0) return;

    const current_sorted_issues = [...issues_list].sort((a, b) => a.rank - b.rank); // Ensure we're working with current rank order

    const dragged_issue = current_sorted_issues.find(issue => issue.id === dragged_item_id);
    if (!dragged_issue) return;

    let new_rank_value: number;

    if (new_position_index === 0) {
      // Move to the very top: rank half of the first issue's rank
      new_rank_value = current_sorted_issues.length > 0 ? current_sorted_issues[0].rank / 2 : 1000;
    } else if (new_position_index >= current_sorted_issues.length) { // Check for >= length to include dragging to end
      // Move to the very bottom: rank higher than the last issue's rank
      new_rank_value = current_sorted_issues.length > 0 ? (current_sorted_issues[current_sorted_issues.length - 1].rank + 1000) : 1000;
    } else {
      // Interpolate rank between new preceding and succeeding issues
      const preceding_issue = current_sorted_issues[new_position_index - 1];
      const succeeding_issue = current_sorted_issues[new_position_index];
      new_rank_value = (preceding_issue.rank + succeeding_issue.rank) / 2;
    }

    update_rank_mutation.mutate({ issue_id: dragged_item_id, new_rank: new_rank_value });
  }, [issues_list, update_rank_mutation]);

  // --- Render Logic ---
  if (!project_id) {
    if (project_key && my_projects.length > 0 && !project) {
        // Project key provided but not found in my_projects
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-semibold text-gray-800">Project Not Found</h2>
                <p className="text-gray-600 mt-2">The project with key "{project_key}" could not be found or you do not have access.</p>
                <Link to="/dashboard" className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Go to My Projects</Link>
            </div>
        );
    }
    // Still loading my_projects or initial state, or no project_key yet
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
        Loading project details...
      </div>
    );
  }

  const handle_search_key_down = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
        handle_search_submit();
    }
  };

  const get_sort_icon = (column: string) => {
    if (current_sort_by === column) {
      return current_sort_order === 'asc' ? ' ▲' : ' ▼';
    }
    return '';
  };

  // --- Main Component Render ---
  return (
    <>
      <h1 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">
        {project_name || project_key} Issues
      </h1>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6 flex flex-wrap items-center gap-4">
        {/* Issue Type Filter */}
        <div className="flex flex-col min-w-[120px]">
          <label htmlFor="issue_type_filter" className="text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            id="issue_type_filter"
            multiple
            value={current_filters.issue_type || []}
            onChange={(e) => handle_filter_change('issue_type', Array.from(e.target.selectedOptions, (option) => option.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm h-full"
          >
            {ISSUE_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex flex-col min-w-[120px]">
          <label htmlFor="status_filter" className="text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            id="status_filter"
            multiple
            value={current_filters.status || []}
            onChange={(e) => handle_filter_change('status', Array.from(e.target.selectedOptions, (option) => option.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm h-full"
          >
            {ISSUE_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        {/* Assignee Filter */}
        <div className="flex flex-col min-w-[150px]">
          <label htmlFor="assignee_filter" className="text-sm font-medium text-gray-700 mb-1">Assignee</label>
          <select
            id="assignee_filter"
            multiple
            value={current_filters.assignee_id || []}
            onChange={(e) => handle_filter_change('assignee_id', Array.from(e.target.selectedOptions, (option) => option.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm h-full"
          >
            {authenticated_user && <option value={authenticated_user.id}>Me ({authenticated_user.first_name})</option>}
            {project_members_list.map(member => (
              <option key={member.id} value={member.id}>
                {member.first_name} {member.last_name}
              </option>
            ))}
          </select>
        </div>

        {/* Reporter Filter */}
        <div className="flex flex-col min-w-[150px]">
          <label htmlFor="reporter_filter" className="text-sm font-medium text-gray-700 mb-1">Reporter</label>
          <select
            id="reporter_filter"
            multiple
            value={current_filters.reporter_id || []}
            onChange={(e) => handle_filter_change('reporter_id', Array.from(e.target.selectedOptions, (option) => option.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm h-full"
          >
            {authenticated_user && <option value={authenticated_user.id}>Me ({authenticated_user.first_name})</option>}
            {project_members_list.map(member => (
              <option key={member.id} value={member.id}>
                {member.first_name} {member.last_name}
              </option>
            ))}
          </select>
        </div>

        {/* Priority Filter */}
        <div className="flex flex-col min-w-[120px]">
          <label htmlFor="priority_filter" className="text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select
            id="priority_filter"
            multiple
            value={current_filters.priority || []}
            onChange={(e) => handle_filter_change('priority', Array.from(e.target.selectedOptions, (option) => option.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm h-full"
          >
            {ISSUE_PRIORITIES.map(priority => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>
        </div>

        {/* Labels Filter (using hardcoded list due to OpenAPI mismatch) */}
        <div className="flex flex-col min-w-[120px]">
          <label htmlFor="labels_filter" className="text-sm font-medium text-gray-700 mb-1">Labels</label>
          <select
            id="labels_filter"
            multiple
            value={current_filters.labels || []}
            onChange={(e) => handle_filter_change('labels', Array.from(e.target.selectedOptions, (option) => option.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm h-full"
          >
            {AVAILABLE_LABELS_MOCK.map(label => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </div>

        {/* Search Bar */}
        <div className="flex flex-grow flex-col">
          <label htmlFor="search_query" className="text-sm font-medium text-gray-700 mb-1">Search</label>
          <input
            id="search_query"
            type="text"
            placeholder="Search key, summary, description..."
            value={search_query_input_value}
            onChange={(e) => set_search_query_input_value(e.target.value)}
            onKeyDown={handle_search_key_down}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900"
          />
        </div>

        <div className="flex flex-col self-end">
            <button
              onClick={handle_search_submit}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap"
            >
              Apply Filters
            </button>
        </div>
        <div className="flex flex-col self-end">
            <button
              onClick={clear_all_filters}
              className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 whitespace-nowrap"
            >
              Clear Filters
            </button>
        </div>
      </div>

      {/* Issues Table */}
      <div className="bg-white p-6 rounded-lg shadow-md overflow-x-auto">
        {issues_loading || members_loading ? (
          <div className="flex items-center justify-center p-8 text-gray-500">
            Fetching issues...
          </div>
        ) : issues_error || members_error ? (
          <div className="flex items-center justify-center p-8 text-red-600">
            Error loading data: {issues_fetch_error?.message || members_fetch_error?.message}
          </div>
        ) : issues_list.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-gray-500">
            No issues found matching your criteria.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('rank')}
                >
                  <span className="inline-block w-4">
                    {/* Placeholder for drag handle, typically provided by DND library */}
                    <span className="text-gray-400">☰</span> {/* Visual drag handle */}
                  </span>
                  Rank {get_sort_icon('rank')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Key
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('summary')}
                >
                  Summary {get_sort_icon('summary')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('issue_type')}
                >
                  Type {get_sort_icon('issue_type')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('status')}
                >
                  Status {get_sort_icon('status')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('assignee')}
                >
                  Assignee {get_sort_icon('assignee')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('priority')}
                >
                  Priority {get_sort_icon('priority')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('due_date')}
                >
                  Due Date {get_sort_icon('due_date')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('reporter')}
                >
                  Reporter {get_sort_icon('reporter')}
                </th>
                <th
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => handle_sort_change('last_updated_at')}
                >
                  Last Updated {get_sort_icon('last_updated_at')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {issues_list.map((issue) => (
                <tr
                  key={issue.id}
                  className="hover:bg-gray-100 cursor-pointer"

                  // Conceptual drag-and-drop attributes. A real DND library would attach event handlers.
                  // These native HTML attributes are for basic drag initiation only.
                  draggable // Makes the row draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', issue.id); // Set issue ID for drag
                    e.currentTarget.classList.add('opacity-50'); // Visual feedback for dragging
                  }}
                  onDragEnd={(e) => {
                    e.currentTarget.classList.remove('opacity-50'); // Remove feedback
                    // This is where a DND library would receive drop information
                    // and an actual reorder action (e.g., handle_row_reorder_conceptual(issue.id, targetIndex)) would be triggered by the DND framework's onDrop/onDragEnd event logic.
                  }}
                  onClick={() => navigate(`/issues/${issue.issue_key}`)}
                >
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    <span className="inline-block w-4 mr-2 text-center text-gray-400 cursor-grab">☰</span> {/* Visual drag handle icon */}
                    {issue.rank}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm font-medium">
                    <Link to={`/issues/${issue.issue_key}`} className="text-blue-600 hover:underline">
                      {issue.issue_key}
                    </Link>
                  </td>
                  <td className="px-4 py-2 whitespace-normal text-sm text-gray-900 max-w-xs overflow-hidden text-ellipsis">
                    {issue.summary}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${ISSUE_TYPE_COLORS[issue.issue_type]}`}>
                      {issue.issue_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {issue.status}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {issue.assignee ? `${issue.assignee.first_name} ${issue.assignee.last_name}` : 'Unassigned'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${PRIORITY_COLORS[issue.priority]}`}>
                      {issue.priority}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {issue.due_date ? new Date(issue.due_date).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {issue.reporter.first_name} {issue.reporter.last_name}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {new Date(issue.last_updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

export default UV_ProjectIssuesList;