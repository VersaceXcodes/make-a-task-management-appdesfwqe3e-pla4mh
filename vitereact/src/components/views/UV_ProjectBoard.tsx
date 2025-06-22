import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';

// Global store and types
import { useAppStore, ProjectListResponse, UserResponse } from '@/store/main';

// --- Type Definitions ---
interface UserSummary {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

interface IssueKanbanCard {
  id: string;
  issue_key: string;
  summary: string;
  assignee: UserSummary | null;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  status: 'To Do' | 'In Progress' | 'Done';
  due_date: string | null; // ISO 8601 datetime string
}

type KanbanStatus = 'To Do' | 'In Progress' | 'Done';

interface BoardIssuesByStatus {
  'To Do': IssueKanbanCard[];
  'In Progress': IssueKanbanCard[];
  'Done': IssueKanbanCard[];
}

interface ProjectMemberResponse {
  id: string; // This is the project_member_id from backend, not user_id
  user_id: string;
  project_id: string;
  role: 'Admin' | 'Member';
  user_details: UserResponse; // Full user details
  created_at: string;
  updated_at: string;
}

interface IssueListResponseItem { // To get labels that are not on KanbanCard
  id: string;
  labels?: { id: string; label_name: string }[];
}

interface IssueStatusUpdateRequest {
  new_status: KanbanStatus;
}

// Adjusted based on OpenAPI's IssueSummary which includes due_date, mapped to IssueKanbanCard for consistency
interface IssueStatusUpdatedEventData {
  id: string;
  project_id: string;
  status: KanbanStatus;
  old_status: KanbanStatus;
  updated_by: UserSummary;
  updated_at: string;
  issue_summary: IssueKanbanCard; // Using IssueKanbanCard containing full issue details from event
}

// Environment variable for API base URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// Axios instance with base URL
const axios_instance = axios.create({ baseURL: API_BASE_URL });

// Kanban Column Definitions (fixed for MVP)
const KANBAN_COLUMNS: KanbanStatus[] = ['To Do', 'In Progress', 'Done'];

// Priority filter options
const PRIORITY_OPTIONS = ['All', 'Highest', 'High', 'Medium', 'Low', 'Lowest'];

// --- Reusable UI Components (rudimentary for this component's scope) ---

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

const Select: React.FC<SelectProps> = ({ options, ...props }) => (
  <select
    {...props}
    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 bg-white"
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

interface IssueCardProps {
  issue: IssueKanbanCard;
}

const IssueCard: React.FC<IssueCardProps> = ({ issue }) => {
  const getPriorityColor = (priority: IssueKanbanCard['priority']) => {
    switch (priority) {
      case 'Highest': return 'bg-red-500';
      case 'High': return 'bg-orange-400';
      case 'Medium': return 'bg-yellow-400';
      case 'Low': return 'bg-green-400';
      case 'Lowest': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  return (
    <Link
      to={`/issues/${issue.id}`} // Navigates to issue details page using issue's unique ID (UUID).
      className="block bg-white rounded-lg shadow-md p-4 mb-3 cursor-pointer hover:bg-gray-50 transition duration-150 ease-in-out"
    >
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-medium text-gray-800">{issue.issue_key}</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold text-white ${getPriorityColor(issue.priority)}`}>
          {issue.priority}
        </span>
      </div>
      <p className="text-gray-700 text-sm mb-2">{issue.summary}</p>
      {issue.assignee && (
        <div className="flex items-center text-xs text-gray-500">
          {issue.assignee.profile_picture_url ? (
            <img
              src={issue.assignee.profile_picture_url}
              alt={issue.assignee.first_name}
              className="w-5 h-5 rounded-full mr-1 object-cover"
            />
          ) : (
            <div className="w-5 h-5 rounded-full mr-1 bg-gray-200 flex items-center justify-center text-gray-600 font-bold">
              {issue.assignee.first_name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="ml-1">{issue.assignee.first_name} {issue.assignee.last_name}</span>
        </div>
      )}
      {issue.due_date && (
        <div className="mt-2 text-xs text-gray-500">
          Due: {new Date(issue.due_date).toLocaleDateString()}
        </div>
      )}
    </Link>
  );
};

// --- Workflow Transitions Logic ---
const isValidKanbanTransition = (oldStatus: KanbanStatus, newStatus: KanbanStatus): boolean => {
  switch (oldStatus) {
    case 'To Do':
      return newStatus === 'In Progress';
    case 'In Progress':
      return newStatus === 'To Do' || newStatus === 'Done';
    case 'Done':
      return newStatus === 'In Progress'; // Reopen
    default:
      return false;
  }
};

// --- UV_ProjectBoard Component ---
const UV_ProjectBoard: React.FC = () => {
  const queryClient = useQueryClient();
  const { project_key } = useParams<{ project_key: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Global state access
  const { authenticated_user, my_projects, add_snackbar_message, get_socket_instance } = useAppStore(
    (state) => ({
      authenticated_user: state.authenticated_user,
      my_projects: state.my_projects,
      add_snackbar_message: state.add_snackbar_message,
      get_socket_instance: state.get_socket_instance,
    })
  );

  // Derive project_id from project_key using global state
  const project_id = useMemo(() => {
    if (!project_key || my_projects.length === 0) return null;
    const project = my_projects.find((p) => p.project_key === project_key);
    if (!project) {
      add_snackbar_message('error', `Project with key "${project_key}" not found or you don't have access.`);
      navigate('/dashboard'); // Redirect to dashboard if project not found
      return null;
    }
    return project.id;
  }, [project_key, my_projects, navigate, add_snackbar_message]);

  // Read filter states from URL params
  const current_filter_assignee_id = searchParams.get('assignee_id') || 'all';
  const current_filter_priority = searchParams.get('priority') || 'All';
  const current_filter_labels_str = searchParams.get('labels');
  const current_filter_labels = current_filter_labels_str ? current_filter_labels_str.split(',') : [];

  // --- Data Fetching: Kanban Issues ---
  const {
    data: kanbanIssuesData,
    isLoading: isLoadingKanbanIssues,
    isError: isErrorKanbanIssues,
    error: kanbanIssuesError,
  } = useQuery<IssueKanbanCard[], Error>({
    queryKey: [
      'kanbanIssues',
      project_id,
      current_filter_assignee_id,
      current_filter_priority,
      current_filter_labels.join(','), // Join for queryKey string representation (for caching unique combinations)
    ],
    queryFn: async () => {
      if (!project_id) throw new Error('Project ID is not available.');
      const params: Record<string, string | string[] | undefined> = {
        assignee_id: current_filter_assignee_id === 'me' ? authenticated_user?.id : current_filter_assignee_id,
        priority: current_filter_priority === 'All' ? undefined : current_filter_priority,
        labels: current_filter_labels.length > 0 ? current_filter_labels : undefined, // FIX: Pass as array, not comma-separated string
      };
      
      // Filter out undefined/null/\"all\" params before sending
      const filteredParams = Object.fromEntries(
          Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== 'all')
      );

      const { data } = await axios_instance.get<IssueKanbanCard[]>(
        `/api/v1/projects/${project_id}/board/issues`,
        { params: filteredParams }
      );
      return data;
    },
    enabled: !!project_id, // Only run query if project_id is available
  });

  const board_issues_by_status: BoardIssuesByStatus = useMemo(() => {
    const grouped: BoardIssuesByStatus = { 'To Do': [], 'In Progress': [], 'Done': [] };
    if (kanbanIssuesData) {
      kanbanIssuesData.forEach((issue) => {
        if (grouped[issue.status]) {
          grouped[issue.status].push(issue);
        }
      });
    }
    return grouped;
  }, [kanbanIssuesData]);

  // --- Data Fetching: Project Members for Assignee Filter ---
  const { data: projectMembersData, isLoading: isLoadingProjectMembers } = useQuery<ProjectMemberResponse[], Error>({
    queryKey: ['projectMembers', project_id],
    queryFn: async () => {
      if (!project_id) throw new Error('Project ID is not available.');
      const { data } = await axios_instance.get<ProjectMemberResponse[]>(
        `/api/v1/projects/${project_id}/members`
      );
      return data;
    },
    enabled: !!project_id,
  });

  const project_members_list: UserSummary[] = useMemo(() => {
    return (
      projectMembersData?.map((member) => ({
        id: member.user_id, // Use user_id as the filter value
        first_name: member.user_details.first_name,
        last_name: member.user_details.last_name,
        profile_picture_url: member.user_details.profile_picture_url,
      })) || []
    );
  }, [projectMembersData]);

  const assigneeOptions = useMemo(() => {
    const options = [{ value: 'all', label: 'All' }, { value: 'me', label: 'Me' }];
    project_members_list.forEach((member) => {
      // Avoid duplicate 'Me' if current user is implicitly included in project_members_list
      if (authenticated_user?.id !== member.id) {
        options.push({ value: member.id, label: `${member.first_name} ${member.last_name}` });
      }
    });
    return options;
  }, [project_members_list, authenticated_user]);

  // --- Data Fetching: Available Labels for Labels Filter ---
  const { data: allProjectIssuesForLabels, isLoading: isLoadingLabels } = useQuery<IssueListResponseItem[], Error>({
    queryKey: ['allProjectIssuesForLabels', project_id],
    queryFn: async () => {
      if (!project_id) throw new Error('Project ID is not available.');
      const { data } = await axios_instance.get<IssueListResponseItem[]>(
        `/api/v1/projects/${project_id}/issues`
      );
      return data;
    },
    enabled: !!project_id,
  });

  const available_labels_list = useMemo(() => {
    const labels = new Set<string>();
    allProjectIssuesForLabels?.forEach((issue) => {
      issue.labels?.forEach((label) => labels.add(label.label_name));
    });
    return Array.from(labels).sort();
  }, [allProjectIssuesForLabels]);

  const labelOptions = useMemo(() => {
    return available_labels_list.map((label) => ({ value: label, label }));
  }, [available_labels_list]);

  // --- Mutation: Update Issue Status via Drag and Drop ---
  const updateIssueStatusMutation = useMutation<
    IssueKanbanCard,
    Error,
    { issueId: string; newStatus: KanbanStatus; oldStatus: KanbanStatus }
  >({
    mutationFn: async ({ issueId, newStatus }) => {
      const { data } = await axios_instance.put<IssueKanbanCard, { data: IssueKanbanCard }>(
        `/api/v1/issues/${issueId}/status`,
        { new_status: newStatus }
      );
      return data;
    },
    onMutate: async (newIssueData) => {
      // Cancel any outgoing refetches for Kanban issues
      await queryClient.cancelQueries({ queryKey: ['kanbanIssues'] });

      // Snapshot the current `kanbanIssues` data
      const previousKanbanIssues = queryClient.getQueryData<IssueKanbanCard[]>(['kanbanIssues']);

      // Optimistically update the cache
      queryClient.setQueryData<IssueKanbanCard[]>(['kanbanIssues'], (old) => {
        if (!old) return [];
        const updated = old.map((issue) =>
          issue.id === newIssueData.issueId ? { ...issue, status: newIssueData.newStatus } : issue
        );
        return updated;
      });

      // Show success on UI (will be replaced by actual success/error later)
      // add_snackbar_message('info', `Moving issue ${derive_issue_key(project_key!, newIssueData.issueId)} to ${newIssueData.newStatus}...`);

      // Return a context object with the snapshotted value
      return { previousKanbanIssues };
    },
    onError: (err, _newIssueData, context) => { // Added _ for unused arg to satisfy ESLint
      // Rollback to the previous cached value
      queryClient.setQueryData(['kanbanIssues'], context?.previousKanbanIssues);
      add_snackbar_message('error', `Failed to move issue: ${err.message}.`);
      console.error('Failed to update issue status:', err);
    },
    onSuccess: (data) => {
      // Invalidate and refetch specific query after success, ensuring UI consistency
      queryClient.invalidateQueries({ queryKey: ['kanbanIssues'] });
      add_snackbar_message('success', `Issue ${data.issue_key} moved to ${data.status} successfully.`);
    },
  });

  // --- Drag and Drop Handler ---
  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result;

      // Dropped outside a droppable area
      if (!destination) return;

      // If dropped in the same column
      if (source.droppableId === destination.droppableId) {
        // Reordering within the same column is not directly supported by this implementation's backend logic.
        // The current Kanban only tracks status changes.
        return;
      }

      const draggedIssue = kanbanIssuesData?.find((issue) => issue.id === draggableId);
      if (!draggedIssue) return;

      const oldStatus = draggedIssue.status;
      const newStatus = destination.droppableId as KanbanStatus;

      // Validate the transition based on predefined workflow
      if (!isValidKanbanTransition(oldStatus, newStatus)) {
        add_snackbar_message('error', `Invalid transition from \"${oldStatus}\" to \"${newStatus}\".`);
        return;
      }

      // Trigger mutation to update status in backend
      updateIssueStatusMutation.mutate({ issueId: draggableId, newStatus, oldStatus });
    },
    [kanbanIssuesData, updateIssueStatusMutation, add_snackbar_message, isValidKanbanTransition]
  );

  // --- WebSocket Real-time Updates ---
  useEffect(() => {
    const socket = get_socket_instance();
    if (!socket || !project_id) { 
      if (project_id) { // Only warn if project_id is available but socket isn't
        console.warn('Socket.IO instance not available or project ID is missing for WebSocket subscription.');
      }
      return;
    }

    // Join the project-specific board room
    socket.emit('join_project_room', project_id);
    console.log(`Joined Socket.IO room: projects/${project_id}/board`);

    // Listener for real-time status updates
    const handleIssueStatusUpdated = (event: { type: string; data: IssueStatusUpdatedEventData }) => {
      const { id: updatedIssueId, status: newStatus, old_status: oldStatusFromEvent, issue_summary } = event.data;

      queryClient.setQueryData<IssueKanbanCard[]>(['kanbanIssues'], (old) => {
        if (!old) return [];

        const existingIssue = old.find(issue => issue.id === updatedIssueId);

        // If the status in cache is already the new status from the event, and it's not a re-confirmation of a prior optimistic change
        // (i.e., if oldStatusFromEvent implies an actual change happened, but our local state already matches newStatus)
        if (existingIssue && existingIssue.status === newStatus && existingIssue.status !== oldStatusFromEvent) {
            return old;
        }

        const isMovingIssue = old.filter(i => i.id !== updatedIssueId);
        const updatedIssueCard: IssueKanbanCard = {
          ...issue_summary, // Use summary from event data for card details (includes due_date)
          id: updatedIssueId,
          status: newStatus,
          issue_key: issue_summary.issue_key, // FIX: Use issue_summary.issue_key directly from event data
        };

        // For simplicity, just replacing/adding for now. `invalidateQueries` potentially re-sorts.
        const finalIssues = [...isMovingIssue, updatedIssueCard];

        return finalIssues;
      });
      console.log(`Real-time update: Issue ${issue_summary.issue_key} moved from ${oldStatusFromEvent} to ${newStatus}`);
    };

    socket.on('issue_status_updated', handleIssueStatusUpdated);

    // Cleanup function
    return () => {
      socket.off('issue_status_updated', handleIssueStatusUpdated);
      // NOTE: Emitting 'leave_project_room' is generally handled by global socket instance lifecycle,
      // not strictly necessary on component unmount if the socket persists across app routes.
      console.log(`Left Socket.IO room: projects/${project_id}/board`);
    };
  }, [project_id, get_socket_instance, queryClient]); // Dependencies for useEffect

  // --- Filter Handlers ---
  const handleAssigneeFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newAssigneeId = e.target.value;
    setSearchParams((prevParams) => {
      if (newAssigneeId === 'all') {
        prevParams.delete('assignee_id');
      } else {
        prevParams.set('assignee_id', newAssigneeId);
      }
      return prevParams;
    });
  };

  const handlePriorityFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPriority = e.target.value;
    setSearchParams((prevParams) => {
      if (newPriority === 'All') {
        prevParams.delete('priority');
      } else {
        prevParams.set('priority', newPriority);
      }
      return prevParams;
    });
  };

  const handleLabelsFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLabels = Array.from(e.target.selectedOptions, (option) => option.value);
    setSearchParams((prevParams) => {
      if (newLabels.length === 0) {
        prevParams.delete('labels');
      } else {
        prevParams.set('labels', newLabels.join(',')); // URL param remains comma-separated string for simplicity
      }
      return prevParams;
    });
  };
  
  if (!project_id) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-gray-600">Project data is loading or project not found...</p>
      </div>
    );
  }

  const project = my_projects.find((p) => p.project_key === project_key);
  const project_name = project ? project.project_name : 'Loading Project...';

  return (
    <>
      <div className="p-6 bg-gray-100 min-h-screen">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">{project_name} Kanban Board</h1>

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-lg shadow-md mb-6 flex space-x-4 items-center">
          <div className="flex-1">
            <label htmlFor="assignee-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Assignee
            </label>
            {isLoadingProjectMembers ? (
              <p className="text-sm text-gray-500">Loading members...</p>
            ) : (
              <Select
                id="assignee-filter"
                value={current_filter_assignee_id}
                onChange={handleAssigneeFilterChange}
                options={assigneeOptions}
              />
            )}
          </div>

          <div className="flex-1">
            <label htmlFor="priority-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <Select
              id="priority-filter"
              value={current_filter_priority}
              onChange={handlePriorityFilterChange}
              options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
            />
          </div>

          <div className="flex-1">
            <label htmlFor="labels-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Labels
            </label>
            {isLoadingLabels ? (
              <p className="text-sm text-gray-500">Loading labels...</p>
            ) : (
              <Select
                id="labels-filter"
                multiple
                value={current_filter_labels}
                onChange={handleLabelsFilterChange}
                options={labelOptions}
              />
            )}
          </div>
        </div>

        {/* Loading and Error States */}
        {isLoadingKanbanIssues && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
            <p className="text-gray-700 mt-4">Loading Kanban issues...</p>
          </div>
        )}

        {isErrorKanbanIssues && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline"> Failed to load issues: {kanbanIssuesError?.message}</span>
          </div>
        )}

        {/* Kanban Board */}

        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {KANBAN_COLUMNS.map((status) => (
              <Droppable droppableId={status} key={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`bg-gray-200 rounded-lg p-4 shadow-inner min-h-[300px]
                      ${snapshot.isDraggingOver ? 'bg-blue-100 ring-4 ring-blue-300' : ''}
                    `}
                  >
                    <h2 className="text-lg font-semibold text-gray-800 mb-4 flex justify-between items-center bg-gray-300 p-2 rounded-md">
                      {status}
                      <span className="text-sm bg-gray-600 text-white rounded-full px-2 py-0.5">
                        {board_issues_by_status[status]?.length || 0}
                      </span>
                    </h2>
                    {board_issues_by_status[status]?.length === 0 && !isLoadingKanbanIssues && (
                      <p className="text-sm text-gray-500 text-center py-4">No issues in this column.</p>
                    )}
                    {board_issues_by_status[status]?.map((issue, index) => (
                      <Draggable key={issue.id} draggableId={issue.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              ...provided.draggableProps.style,
                              opacity: snapshot.isDragging ? 0.8 : 1,
                              backgroundColor: snapshot.isDragging ? '#e0f2fe' : 'white', // Lighter hover effect
                            }}
                          >
                            <IssueCard issue={issue} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
      </div>
    </>
  );
};

export default UV_ProjectBoard;