import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { format, isBefore, isValid, parseISO } from 'date-fns';
import { useAppStore } from '@/store/main';
import ReactMarkdown from 'react-markdown';
import io from 'socket.io-client'; // Import socket.io-client

// --- Type Definitions (from PRD, FRD, Datamap, OpenAPI) ---

interface UserSummaryForDetails {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

interface ProjectSummaryForDetails {
  id: string;
  project_name: string;
  project_key: string;
}

interface LabelResponse {
  id: string;
  label_name: string;
}

interface AttachmentResponse {
  id: string;
  issue_id: string;
  file_name: string;
  file_url: string;
  mime_type: string;
  file_size: number;
  uploaded_by: UserSummaryForDetails;
  created_at: string;
}

interface IssueSummaryForSubtask {
  id: string;
  issue_key: string;
  summary: string;
  assignee: UserSummaryForDetails | null;
  status: 'To Do' | 'In Progress' | 'Done';
  project_key: string;
}

interface IssueLinkedResponseItem {
  id: string;
  issue_key: string;
  summary: string;
  project_key: string;
  link_type: 'relates_to';
}

interface ActivityLogComment {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ActivityLogEntry {
  id: string;
  user: UserSummaryForDetails;
  action_type: 'issue_created' | 'status_changed' | 'assignee_changed' | 'reporter_changed' | 'priority_changed' | 'due_date_changed' | 'summary_updated' | 'description_updated' | 'label_added' | 'label_removed' | 'attachment_added' | 'attachment_removed' | 'comment_added' | 'comment_edited' | 'comment_deleted' | 'issue_linked' | 'issue_unlinked' | 'subtask_created';
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  comment: ActivityLogComment | null;
  created_at: string;
}

interface IssueDetailedResponse {
  id: string;
  project_id: string;
  project_summary: ProjectSummaryForDetails;
  issue_type: 'Task' | 'Bug' | 'Story';
  issue_key: string;
  summary: string;
  description: string | null;
  assignee: UserSummaryForDetails | null;
  reporter: UserSummaryForDetails;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  status: 'To Do' | 'In Progress' | 'Done';
  due_date: string | null;
  parent_issue_id: string | null;
  rank: number;
  created_at: string;
  updated_at: string;
  labels: LabelResponse[];
  attachments: AttachmentResponse[];
  sub_tasks: IssueSummaryForSubtask[];
  linked_issues: IssueLinkedResponseItem[];
  activity_log: ActivityLogEntry[];
}

interface IssueSearchResponseItem {
  id: string;
  issue_key: string;
  summary: string;
  project_id: string;
  project_name: string;
  project_key: string;
}

interface IssueUpdateRequest {
  summary?: string;
  description?: string | null;
  assignee_user_id?: string | null;
  priority?: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  due_date?: string | null;
  labels?: string[];
  attachments?: AttachmentUploadRequest[];
}

interface IssueStatusUpdateRequest {
  new_status: 'To Do' | 'In Progress' | 'Done';
}

interface CommentCreateRequest {
  comment_content: string;
}

interface CommentUpdateRequest {
  comment_content: string;
}

interface AttachmentUploadRequest {
  file_name: string;
  file_url: string;
  mime_type: string;
  file_size: number;
}

interface IssueLinkCreateRequest {
  target_issue_id: string;
  link_type: 'relates_to';
}

interface SubTaskCreateRequest {
  summary: string;
  assignee_user_id: string | null;
}

// --- Environment Variables ---
const VITE_API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';
const VITE_WS_BASE_URL: string = (import.meta.env.VITE_WS_BASE_URL as string) || 'http://localhost:3000';

// --- Axios Instance ---
const api = axios.create({
  baseURL: VITE_API_BASE_URL,
});

// --- Functional Component ---
const UV_IssueDetails: React.FC = () => {
  const { issue_key: slug_issue_key } = useParams<{ issue_key: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Zustand Global State
  const {
    authenticated_user,
    my_projects,
    add_snackbar_message,
    set_global_loading,
    get_socket_instance,
  } = useAppStore();

  const [issueId, setIssueId] = useState<string | null>(null);
  const [current_comment_input_value, setCurrentCommentInputValue] = useState<string>('');
  const [is_edit_active_for_comments, setIsEditActiveForComments] = useState<{ [commentId: string]: boolean }>({});
  const [edit_comment_input_value, setEditCommentInputValue] = useState<{ [commentId: string]: string }>({});
  const [dialog_state_link_issue, setDialogStateLinkIssue] = useState<boolean>(false);
  const [link_issue_target_id_input_value, setLinkIssueTargetIdInputValue] = useState<string>('');
  const [dialog_state_add_subtask, setDialogStateAddSubtask] = useState<boolean>(false);
  const [new_subtask_summary_input, setNewSubtaskSummaryInput] = useState<string>('');
  const [new_subtask_assignee_input, setNewSubtaskAssigneeInput] = useState<string | null>(null);
  const [show_delete_confirmation, setShowDeleteConfirmation] = useState<boolean>(false);
  const [item_to_delete_id, setItemToDeleteId] = useState<string | null>(null);
  const [delete_confirm_type, setDeleteConfirmType] = useState<'issue' | 'comment' | 'attachment' | 'link' | null>(null);

  // --- Utility Functions ---
  const getIssuePriorityColor = (priority: IssueDetailedResponse['priority']) => {
    switch (priority) {
      case 'Highest': return 'text-red-600';
      case 'High': return 'text-orange-600';
      case 'Medium': return 'text-yellow-600';
      case 'Low': return 'text-green-600';
      case 'Lowest': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusColor = (status: IssueDetailedResponse['status']) => {
    switch (status) {
      case 'To Do': return 'bg-gray-200 text-gray-800';
      case 'In Progress': return 'bg-blue-200 text-blue-800';
      case 'Done': return 'bg-green-200 text-green-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getUserInitials = (user: UserSummaryForDetails) => (user.first_name?.[0] || '') + (user.last_name?.[0] || '');

  const formatDateTime = (isoString: string) => {
    if (!isoString) return 'N/A';
    try {
      return format(parseISO(isoString), 'MMM dd, yyyy hh:mm a');
    } catch (e) {
      return isoString;
    }
  };

  // --- Real-time Socket.IO Integration ---
  useEffect(() => {
    const socket = get_socket_instance();
    if (!socket || !issueId) return;

    socket.emit('join_issue_room', issueId);
    console.log(`Socket.IO: Joined issue room ${issueId}`);

    const handleIssueDetailsUpdated = (event: { type: string, data: { issue_id: string, updated_fields: IssueDetailedResponse, activity_log_entry: ActivityLogEntry } }) => {
      console.log('Socket.IO: Received issue_details_updated event:', event);
      if (event.data.issue_id === issueId) {
        queryClient.setQueryData<IssueDetailedResponse | undefined>(['issue_details', issueId], (oldData) => {
          if (!oldData) return event.data.updated_fields; // If no old data, set new data
          // Update issue details with the comprehensive object from updated_fields
          const newIssueDetails = { ...oldData, ...event.data.updated_fields };

          // Append new activity log entry if it's not already there (based on ID)
          const newActivityLog = [...newIssueDetails.activity_log];
          if (!newActivityLog.some(entry => entry.id === event.data.activity_log_entry.id)) {
            newActivityLog.push(event.data.activity_log_entry);
            newActivityLog.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          }
          return { ...newIssueDetails, activity_log: newActivityLog };
        });
      }
    };

    const handleIssueCommentAdded = (event: { type: string, data: { issue_id: string, comment: ActivityLogComment } }) => {
      console.log('Socket.IO: Received issue_comment_added event:', event);
      if (event.data.issue_id === issueId) {
        queryClient.setQueryData<IssueDetailedResponse | undefined>(['issue_details', issueId], (oldData) => {
          if (!oldData) return oldData; // Can't update if no old data
          const newActivityLog = [...oldData.activity_log];
          // Check if it's already added to prevent duplicates from backend's activity_log_entry
          if (!newActivityLog.some(entry => entry.comment?.id === event.data.comment.id)) {
              newActivityLog.push({
                  id: `activity-${event.data.comment.id}`, // Placeholder ID for activity entry, should be provided by backend
                  user: event.data.comment.user, // Assuming comment also contains user details
                  action_type: 'comment_added',
                  field_name: null,
                  old_value: null,
                  new_value: null,
                  comment: event.data.comment,
                  created_at: event.data.comment.created_at,
              });
              newActivityLog.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          }
          return { ...oldData, activity_log: newActivityLog };
        });
      }
    };

    socket.on('issue_details_updated', handleIssueDetailsUpdated);
    socket.on('issue_comment_added', handleIssueCommentAdded);

    return () => {
      socket.off('issue_details_updated', handleIssueDetailsUpdated);
      socket.off('issue_comment_added', handleIssueCommentAdded);
      socket.emit('leave_issue_room', issueId);
      console.log(`Socket.IO: Left issue room ${issueId}`);
    };
  }, [issueId, get_socket_instance, queryClient]);


  // --- Queries ---

  // 1. Resolve issue_key to issue_id
  const {
      isPending: isResolvingIssueKey,
      isError: isIssueKeyResolutionError,
      error: issueKeyResolutionError,
      data: resolvedIssue,
  } = useQuery<IssueSearchResponseItem[], Error>({
      queryKey: ['resolved_issue_id', slug_issue_key],
      queryFn: async () => {
          if (!slug_issue_key) throw new Error('Issue key is missing.');
          set_global_loading(true);
          const { data } = await api.get<IssueSearchResponseItem[]>(`/api/v1/search/issues?query=${slug_issue_key}`);
          set_global_loading(false);
          return data;
      },
      enabled: !!slug_issue_key,
      refetchOnWindowFocus: false, // Prevents immediate refetch
      staleTime: 1000 * 60 * 5, // 5 minutes stale time for lookup
      onSuccess: (data) => {
          if (data && data.length > 0 && data[0].issue_key === slug_issue_key) {
              setIssueId(data[0].id);
          } else {
              setIssueId(null);
              add_snackbar_message('error', `Issue '${slug_issue_key}' not found or invalid.`);
          }
      },
      onError: (err) => {
          setIssueId(null);
          add_snackbar_message('error', `Error resolving issue key: ${err.message}.`);
      },
  });

  // 2. Fetch issue details using the resolved issue_id
  const {
    data: issue_details,
    isPending: isIssueDetailsLoading,
    isError: isIssueDetailsError,
    error: issueDetailsError,
    isLoading: isInitialLoading, // Use isLoading for initial fetch state
  } = useQuery<IssueDetailedResponse, Error>({
    queryKey: ['issue_details', issueId],
    queryFn: async () => {
      if (!issueId) throw new Error('Issue ID not available.');
      set_global_loading(true);
      const { data } = await api.get<IssueDetailedResponse>(`/api/v1/issues/${issueId}`);
      set_global_loading(false);
      return data;
    },
    enabled: !!issueId, // Only run when issueId is available
    staleTime: 1000 * 60, // Keep issue details fresh for longer
    onSuccess: (data) => {
        // You might want to pre-fetch project members here if not already available
        // for assignee dropdowns. Or, rely on a separate query. For now, rely on useMemo from global state.
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to load issue details: ${err.message}. ${err.message.includes('403') ? 'You may not have access to this issue.' : ''}`);
    },
  });

  // Fetch all users in context for assignee dropdowns (e.g., for subtasks / main issue)
  // This assumes the project_id is available from issue_details once loaded.
  const { data: project_members_all } = useQuery<UserSummaryForDetails[], Error>({
    queryKey: ['project_members', issue_details?.project_id],
    queryFn: async () => {
      if (!issue_details?.project_id) return [];
      const response = await api.get(`/api/v1/projects/${issue_details.project_id}/members`);
      return response.data.map((member: any) => ({
        id: member.user_details.id,
        first_name: member.user_details.first_name,
        last_name: member.user_details.last_name,
        profile_picture_url: member.user_details.profile_picture_url,
      }));
    },
    enabled: !!issue_details?.project_id,
    staleTime: 1000 * 60 * 60, // Cache for an hour
  });


  const currentProjectRole = useMemo(() => {
    if (!issue_details || !authenticated_user || !my_projects) return 'Member';
    const project = my_projects.find(p => p.id === issue_details.project_id);
    return project?.user_role || 'Member';
  }, [issue_details, authenticated_user, my_projects]);

  const isProjectAdmin = currentProjectRole === 'Admin';
  const isAssignee = issue_details?.assignee?.id === authenticated_user?.id;
  const isReporter = issue_details?.reporter.id === authenticated_user?.id;
  const canEditIssue = isProjectAdmin || isAssignee || isReporter;

  // --- Mutations ---

  // Update Issue fields
  const updateIssueMutation = useMutation<IssueDetailedResponse, Error, { issueId: string, payload: IssueUpdateRequest }>({
    mutationFn: async ({ issueId, payload }) => {
      set_global_loading(true);
      const { data } = await api.put<IssueDetailedResponse>(`/api/v1/issues/${issueId}`, payload);
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue_details', issueId] });
      add_snackbar_message('success', 'Issue updated successfully!');
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to update issue: ${err.message}.`);
    },
  });

  // Change Issue Status
  const changeStatusMutation = useMutation<any, Error, { issueId: string, status: IssueStatusUpdateRequest['new_status'] }>({
    mutationFn: async ({ issueId, status }) => {
      set_global_loading(true);
      const { data } = await api.put(`/api/v1/issues/${issueId}/status`, { new_status: status });
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue_details', issueId] }); // To update activity log & current status
      queryClient.invalidateQueries({ queryKey: ['project_board'] }); // To update kanban board
      queryClient.invalidateQueries({ queryKey: ['project_issues_list'] }); // To update list view
      queryClient.invalidateQueries({ queryKey: ['my_assigned_issues'] }); // To update "My Work"
      add_snackbar_message('success', 'Issue status updated!');
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to change status: ${err.message}.`);
    },
  });

  // Add Comment
  const addCommentMutation = useMutation<any, Error, { issueId: string, comment_content: string }>({
    mutationFn: async ({ issueId, comment_content }) => {
      const { data } = await api.post(`/api/v1/issues/${issueId}/comments`, { comment_content });
      return data;
    },
    onSuccess: () => {
      setCurrentCommentInputValue('');
      add_snackbar_message('success', 'Comment added!');
      // Real-time update via socket will update the activity log
    },
    onError: (err) => {
      add_snackbar_message('error', `Failed to add comment: ${err.message}.`);
    },
  });

  // Edit Comment
  const editCommentMutation = useMutation<any, Error, { commentId: string, comment_content: string }>({
    mutationFn: async ({ commentId, comment_content }) => {
      const { data } = await api.put(`/api/v1/comments/${commentId}`, { comment_content });
      return data;
    },
    onSuccess: (data, variables) => {
        setIsEditActiveForComments(prev => ({ ...prev, [variables.commentId]: false }));
        add_snackbar_message('success', 'Comment edited!');
        // Real-time update via socket will update the activity log
    },
    onError: (err, variables) => {
        setIsEditActiveForComments(prev => ({ ...prev, [variables.commentId]: false }));
        add_snackbar_message('error', `Failed to edit comment: ${err.message}.`);
    },
  });

  // Delete Comment
  const deleteCommentMutation = useMutation<any, Error, string>({
    mutationFn: async (commentId) => {
      set_global_loading(true);
      const { data } = await api.delete(`/api/v1/comments/${commentId}`);
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      add_snackbar_message('success', 'Comment deleted!');
      // Real-time update via socket will update the activity log
    },
    onError: (err) => {
      add_snackbar_message('error', `Failed to delete comment: ${err.message}.`);
    },
  });

  // Upload Attachment
  const uploadAttachmentMutation = useMutation<AttachmentResponse, Error, { issueId: string, file: File }>({
    mutationFn: async ({ issueId, file }) => {
      set_global_loading(true);
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<AttachmentResponse>(`/api/v1/issues/${issueId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      add_snackbar_message('success', 'Attachment uploaded!');
      // Real-time updates handled by socket
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to upload attachment: ${err.message}.`);
    },
  });

  // Delete Attachment
  const deleteAttachmentMutation = useMutation<any, Error, string>({
    mutationFn: async (attachmentId) => {
      set_global_loading(true);
      const { data } = await api.delete(`/api/v1/attachments/${attachmentId}`);
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      add_snackbar_message('success', 'Attachment deleted!');
      // Real-time updates handled by socket
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to delete attachment: ${err.message}.`);
    },
  });

  // Link Issue
  const linkIssueMutation = useMutation<any, Error, { sourceIssueId: string, targetIssueKey: string }>({
    mutationFn: async ({ sourceIssueId, targetIssueKey }) => {
      set_global_loading(true);
      // First, resolve targetIssueKey to targetIssueId
      const searchRes = await api.get<IssueSearchResponseItem[]>(`/api/v1/search/issues?query=${targetIssueKey}`);
      if (!searchRes.data || searchRes.data.length === 0 || searchRes.data[0].issue_key !== targetIssueKey) {
        throw new Error(`Target issue '${targetIssueKey}' not found.`);
      }
      const targetIssueId = searchRes.data[0].id;

      const payload: IssueLinkCreateRequest = { target_issue_id: targetIssueId, link_type: 'relates_to' };
      const { data } = await api.post(`/api/v1/issues/${sourceIssueId}/links`, payload);
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      setDialogStateLinkIssue(false);
      setLinkIssueTargetIdInputValue('');
      add_snackbar_message('success', 'Issue linked successfully!');
      // Real-time updates handled by socket
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to link issue: ${err.message}.`);
    },
  });

  // Delete Issue Link
  const deleteIssueLinkMutation = useMutation<any, Error, string>({
      mutationFn: async (linkId) => {
        set_global_loading(true);
        const { data } = await api.delete(`/api/v1/issue_links/${linkId}`);
        set_global_loading(false);
        return data;
      },
      onSuccess: () => {
        add_snackbar_message('success', 'Issue link removed!');
        // Real-time updates handled by socket
      },
      onError: (err) => {
        set_global_loading(false);
        add_snackbar_message('error', `Failed to remove issue link: ${err.message}.`);
      },
  });

  // Add Sub-task
  const addSubTaskMutation = useMutation<any, Error, { issueId: string, summary: string, assignee_id: string | null }>({
    mutationFn: async ({ issueId, summary, assignee_id }) => {
      set_global_loading(true);
      if (!issue_details) throw new Error('Parent issue details not loaded.');
      const payload: Omit<IssueCreateRequest, 'project_id'> = {
        issue_type: 'Task', // Sub-tasks are generally tasks
        summary: summary,
        assignee_user_id: assignee_id,
        priority: 'Medium', // Default priority for sub-tasks
        parent_issue_id: issueId,
      };
      // The backend expects project_id in the path for issue creation
      const { data } = await api.post(`/api/v1/projects/${issue_details.project_id}/issues`, payload);
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      setDialogStateAddSubtask(false);
      setNewSubtaskSummaryInput('');
      setNewSubtaskAssigneeInput(null);
      add_snackbar_message('success', 'Sub-task added successfully!');
      // Real-time updates handled by socket
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to add sub-task: ${err.message}.`);
    },
  });

  // Delete Issue
  const deleteIssueMutation = useMutation<any, Error, string>({
    mutationFn: async (issueIdToDelete) => {
      set_global_loading(true);
      const data = await api.delete(`/api/v1/issues/${issueIdToDelete}`);
      set_global_loading(false);
      return data;
    },
    onSuccess: () => {
      setShowDeleteConfirmation(false);
      add_snackbar_message('success', 'Issue deleted successfully!');
      navigate(`/projects/${issue_details?.project_key}/issues`); // Redirect to issues list
    },
    onError: (err) => {
      set_global_loading(false);
      add_snackbar_message('error', `Failed to delete issue: ${err.message}.`);
    },
  });

  // --- Handlers for inline editing ---
  const handleFieldChange = (field: keyof IssueUpdateRequest, value: any) => {
    if (!issueId) return;
    let payload_value = value;
    if (field === 'due_date' && value) {
      payload_value = format(parseISO(value), 'yyyy-MM-dd HH:mm:ss'); // Ensure correct format
    }
    updateIssueMutation.mutate({ issueId, payload: { [field]: payload_value } });
  };

  const handleLabelsChange = (newLabels: string[]) => {
    if (!issueId) return;
    updateIssueMutation.mutate({ issueId, payload: { labels: newLabels } });
  };

  const handleStatusChange = (newStatus: IssueStatusUpdateRequest['new_status']) => {
    if (!issueId) return;
    changeStatusMutation.mutate({ issueId, status: newStatus });
  };

  const handleAddComment = () => {
    if (!issueId || !current_comment_input_value.trim()) {
      add_snackbar_message('error', 'Comment cannot be empty.');
      return;
    }
    addCommentMutation.mutate({ issueId, comment_content: current_comment_input_value });
  };

  const handleEditComment = (commentId: string) => {
    if (isEditActiveForComments[commentId]) { // If already editing, save
        const content = edit_comment_input_value[commentId]?.trim();
        if (content) {
            editCommentMutation.mutate({ commentId, comment_content: content });
        } else {
            add_snackbar_message('error', 'Edited comment cannot be empty.');
        }
    } else { // Start editing
        const comment = issue_details?.activity_log.find(entry => entry.comment?.id === commentId)?.comment;
        if (comment && comment.deleted_at === null && authenticated_user?.id === issue_details?.activity_log.find(entry => entry.comment?.id === commentId)?.user.id) {
            // Check 5-minute window for user's own comments
            const commentAgeMs = new Date().getTime() - new Date(comment.created_at).getTime();
            const fiveMinutesMs = 5 * 60 * 1000;
            if (commentAgeMs <= fiveMinutesMs) {
                setIsEditActiveForComments(prev => ({ ...prev, [commentId]: true }));
                setEditCommentInputValue(prev => ({ ...prev, [commentId]: comment.content }));
            } else {
                add_snackbar_message('error', 'Cannot edit. The 5-minute edit window has expired.');
            }
        } else if (isProjectAdmin) { // Allow admin to edit any non-deleted comment
            const adminComment = issue_details?.activity_log.find(entry => entry.comment?.id === commentId)?.comment;
            if(adminComment && adminComment.deleted_at === null) {
                setIsEditActiveForComments(prev => ({ ...prev, [commentId]: true }));
                setEditCommentInputValue(prev => ({ ...prev, [commentId]: adminComment.content }));
            }
        } else {
            add_snackbar_message('error', 'You can only edit your own comments within 5 minutes of posting.');
        }
    }
  };

  const handleCancelEditComment = (commentId: string) => {
    setIsEditActiveForComments(prev => ({ ...prev, [commentId]: false }));
    setEditCommentInputValue(prev => { delete prev[commentId]; return { ...prev }; });
  };

  const handleDeleteComment = (commentId: string) => {
    setItemToDeleteId(commentId);
    setDeleteConfirmType('comment');
    setShowDeleteConfirmation(true);
  };

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!issueId || !event.target.files?.length) return;
    const file = event.target.files[0];
    if (file) {
      uploadAttachmentMutation.mutate({ issueId, file });
    }
  }, [issueId, uploadAttachmentMutation]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!issueId) return;
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      uploadAttachmentMutation.mutate({ issueId, file });
    }
  }, [issueId, uploadAttachmentMutation]);

  const handleDeleteAttachment = (attachmentId: string) => {
    setItemToDeleteId(attachmentId);
    setDeleteConfirmType('attachment');
    setShowDeleteConfirmation(true);
  };

  const handleLinkIssue = () => {
    if (!issueId || !link_issue_target_id_input_value.trim()) {
      add_snackbar_message('error', 'Please enter an issue key to link.');
      return;
    }
    linkIssueMutation.mutate({ sourceIssueId: issueId, targetIssueKey: link_issue_target_id_input_value });
  };

  const handleRemoveLink = (linkId: string) => {
      setItemToDeleteId(linkId);
      setDeleteConfirmType('link');
      setShowDeleteConfirmation(true);
  }

  const handleAddSubTask = () => {
    if (!issueId || !issue_details || !new_subtask_summary_input.trim()) {
      add_snackbar_message('error', 'Sub-task summary cannot be empty.');
      return;
    }
    addSubTaskMutation.mutate({
      issueId,
      summary: new_subtask_summary_input,
      assignee_id: new_subtask_assignee_input,
    });
  };

  const handleDeleteIssue = useCallback(() => {
    setItemToDeleteId(issueId);
    setDeleteConfirmType('issue');
    setShowDeleteConfirmation(true);
  }, [issueId]);


  const confirmDeletion = () => {
    if (!issueId || !item_to_delete_id || !delete_confirm_type) return;

    switch (delete_confirm_type) {
      case 'issue':
        deleteIssueMutation.mutate(issueId);
        break;
      case 'comment':
        deleteCommentMutation.mutate(item_to_delete_id);
        break;
      case 'attachment':
        deleteAttachmentMutation.mutate(item_to_delete_id);
        break;
      case 'link':
          deleteIssueLinkMutation.mutate(item_to_delete_id);
          break;
    }
    setShowDeleteConfirmation(false);
    setItemToDeleteId(null);
    setDeleteConfirmType(null);
  };

  // Render Logic
  if (isResolvingIssueKey || isInitialLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="text-xl">Loading issue...</div>
      </div>
    );
  }

  if (isIssueKeyResolutionError || !issueId || isIssueDetailsError || !issue_details) {
    return (
      <div className="flex flex-col justify-center items-center h-screen text-red-600">
        <h2 className="text-2xl font-bold mb-4">Error Loading Issue</h2>
        {isIssueKeyResolutionError && <p>Error resolving issue key: {issueKeyResolutionError?.message}</p>}
        {(!issueId && !isIssueKeyResolutionError) && <p>Issue '{slug_issue_key}' not found or invalid format.</p>}
        {isIssueDetailsError && <p>Failed to load issue details: {issueDetailsError?.message}</p>}
        {!issue_details && <p>Issue details could not be retrieved.</p>}
        <Link to={`/projects/${issue_details?.project_key || 'dashboard'}/issues`} className="mt-4 text-blue-600 hover:underline">
          Go back to Project Issues
        </Link>
      </div>
    );
  }

  const hasActivity = issue_details.activity_log && issue_details.activity_log.length > 0;
  const canDelete = isProjectAdmin; // Only project admin can delete the issue itself

  // For Markdown, highlight @mentions manually for now
  const renderMarkdownWithMentions = (markdownText: string | null) => {
    if (!markdownText) return null;
    const projectMemberNames = (project_members_all || []).map(member => `${member.first_name} ${member.last_name}`);
    const regex = new RegExp(`@(${projectMemberNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');

    return (
      <ReactMarkdown
        components={{
          a: ({ node, ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />,
          span: ({ node, className, ...props }) => {
            const childrenText = Array.isArray(props.children) ? props.children.join('') : props.children?.toString();
            if (childrenText && typeof childrenText === 'string' && childrenText.match(regex)) {
                return <span className="bg-blue-100 text-blue-800 rounded px-1" {...props}>{childrenText}</span>;
            }
            return <span {...props}>{props.children}</span>;
          }
        }}
      >
        {markdownText.replace(regex, (match, p1) => `<span class="mention">${match}</span>`)}
      </ReactMarkdown>
    );
  };


  return (
    <div className="container mx-auto p-6 bg-white shadow-lg rounded-lg min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-800">{issue_details.issue_key}</h1>
          <p className="text-xl font-semibold text-gray-800 flex items-center">
            {issue_details.issue_type} - {issue_details.summary}
            <button
              onClick={() => handleFieldChange('summary', prompt('Edit Summary:', issue_details.summary))}
              className="ml-2 text-blue-500 hover:text-blue-700 disabled:opacity-50"
              disabled={!canEditIssue}
              title="Edit Summary"
            >
                <svg className="w-4 h-4 inline-block" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 11C15 5.5v1.293l-7 7L4 14l1.293-4.293 7-7zM15 7l-3-3 2-2 3 3-2 2z"></path></svg>
            </button>
          </p>
        </div>
        <div className="flex space-x-3">
          {/* Status Update Button/Dropdown */}
          <div className="relative group">
            <button
              className={`px-4 py-2 rounded-full font-semibold ${getStatusColor(issue_details.status)} hover:opacity-80 disabled:opacity-50`}
              disabled={!canEditIssue}
            >
              {issue_details.status}
              <svg className="w-3 h-3 ml-1 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            {canEditIssue && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                {issue_details.status !== 'To Do' && (issue_details.status === 'In Progress' || issue_details.status === 'Done') && (
                  <button
                    onClick={() => handleStatusChange('To Do')}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Set to To Do
                  </button>
                )}
                {issue_details.status !== 'In Progress' && (
                  <button
                    onClick={() => handleStatusChange('In Progress')}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Start Progress
                  </button>
                )}
                {issue_details.status !== 'Done' && issue_details.status === 'In Progress' && (
                  <button
                    onClick={() => handleStatusChange('Done')}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Mark as Done
                  </button>
                )}
                {issue_details.status === 'Done' && (
                  <button
                    onClick={() => handleStatusChange('In Progress')}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Reopen
                  </button>
                )}
              </div>
            )}
          </div>
          {canDelete && (
            <button
              onClick={handleDeleteIssue}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
              disabled={!canDelete}
            >
              Delete Issue
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Details & Description */}
        <div className="md:col-span-2">
          <div className="space-y-6">
            {/* Description */}
            <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Description</h3>
              <div className="text-gray-700 prose max-w-none">
                {issue_details.description ? renderMarkdownWithMentions(issue_details.description) : 'No description provided.'}
              </div>
              <button
                onClick={() => handleFieldChange('description', prompt('Edit Description:', issue_details.description || ''))}
                className="mt-2 text-blue-500 hover:text-blue-700 disabled:opacity-50 text-sm"
                disabled={!canEditIssue}
              >
                Edit Description
              </button>
            </div>

            {/* Labels */}
            <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Labels</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                    {issue_details.labels.map(label => (
                        <span key={label.id} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {label.label_name}
                            {canEditIssue && (
                                <button
                                    onClick={() => handleLabelsChange(issue_details.labels.filter(l => l.id !== label.id).map(l => l.label_name))}
                                    className="ml-1 -mr-0.5 h-3.5 w-3.5 rounded-full flex items-center justify-center text-blue-400 hover:bg-blue-200 hover:text-blue-500"
                                    aria-label="Remove label"
                                >
                                    <span className="sr-only">Remove label</span>
                                    <svg className="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" /></svg>
                                </button>
                            )}
                        </span>
                    ))}
                    {issue_details.labels.length === 0 && <span className="text-gray-500">No labels.</span>}
                </div>
                {canEditIssue && (
                    <div className="flex items-center">
                        <input
                            type="text"
                            placeholder="Add new label..."
                            className="flex-grow p-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const newLabel = e.currentTarget.value.trim();
                                    if (newLabel && !issue_details.labels.some(l => l.label_name.toLowerCase() === newLabel.toLowerCase())) {
                                        handleLabelsChange([...issue_details.labels.map(l => l.label_name), newLabel]);
                                        e.currentTarget.value = '';
                                    }
                                }
                            }}
                        />
                    </div>
                )}
            </div>


            {/* Attachments */}
            <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Attachments ({issue_details.attachments.length})</h3>
                <div className="border border-dashed border-gray-300 rounded-lg p-4 text-center mb-4"
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={handleDrop}>
                    <p className="text-gray-500 mb-2">Drag &amp; drop files here, or click to upload</p>
                    <input
                        type="file"
                        className="hidden"
                        id="attachment-upload"
                        onChange={handleFileUpload}
                        disabled={!canEditIssue}
                    />
                    <label
                        htmlFor="attachment-upload"
                        className="px-4 py-2 bg-blue-500 text-white rounded-md cursor-pointer hover:bg-blue-600 disabled:opacity-50"
                    >
                        Browse Files
                    </label>
                </div>
                {issue_details.attachments.length > 0 && (
                    <ul className="space-y-2">
                        {issue_details.attachments.map(attachment => (
                            <li key={attachment.id} className="flex items-center justify-between bg-white p-2 rounded-md shadow-sm border border-gray-200">
                                <a href={attachment.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center">
                                    <svg className="w-5 h-5 mr-2 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path d="M13 7H7V5h6v2zm0 4H7V9h6v2zm-2 4H7v-2h4v2z"></path><path fillRule="evenodd" d="M3 3a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V3zm0 16v-1a2 2 0 012-2h10a2 2 0 012 2v1a2 2 0 01-2 2H5a2 2 0 01-2-2z" clipRule="evenodd"></path></svg>
                                    {attachment.file_name} ({Math.round(attachment.file_size / 1024)} KB)
                                </a>
                                {(isProjectAdmin || attachment.uploaded_by.id === authenticated_user?.id) && (
                                    <button
                                        onClick={() => handleDeleteAttachment(attachment.id)}
                                        className="text-red-500 hover:text-red-700 ml-2"
                                        title="Delete attachment"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1z" clipRule="evenodd"></path></svg>
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Sub-tasks */}
            <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Sub-tasks ({issue_details.sub_tasks.length})</h3>
                {issue_details.sub_tasks.length > 0 ? (
                    <ul className="space-y-2">
                        {issue_details.sub_tasks.map(subtask => (
                            <li key={subtask.id} className="flex items-center justify-between p-2">
                                <Link to={`/issues/${subtask.issue_key}`} className="text-blue-600 hover:underline">
                                    <span className="font-medium">{subtask.issue_key}:</span> {subtask.summary}
                                </Link>
                                <span className="flex items-center space-x-2">
                                    {subtask.assignee ? (
                                        <div className="flex items-center text-sm text-gray-600">
                                            {subtask.assignee.profile_picture_url ? (
                                                <img src={subtask.assignee.profile_picture_url} alt={getUserInitials(subtask.assignee)} className="w-5 h-5 rounded-full mr-1" />
                                            ) : (
                                                <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-xs text-gray-700 mr-1">{getUserInitials(subtask.assignee)}</div>
                                            )}
                                            {subtask.assignee.first_name} {subtask.assignee.last_name}
                                        </div>
                                    ) : (
                                        <span className="text-sm text-gray-500">Unassigned</span>
                                    )}
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(subtask.status)}`}>
                                        {subtask.status}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-500">No sub-tasks yet.</p>
                )}
                {canEditIssue && (
                    <button
                        onClick={() => setDialogStateAddSubtask(true)}
                        className="mt-4 px-4 py-2 text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
                    >
                        Add Sub-task
                    </button>
                )}
            </div>

            {/* Linked Issues */}
            <div className="bg-gray-50 p-4 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Linked Issues ({issue_details.linked_issues.length})</h3>
                {issue_details.linked_issues.length > 0 ? (
                    <ul className="space-y-2">
                        {issue_details.linked_issues.map(linked => (
                            <li key={linked.id} className="flex items-center justify-between p-2">
                                <Link to={`/issues/${linked.issue_key}`} className="text-blue-600 hover:underline">
                                    <span className="font-medium">{linked.link_type === 'relates_to' ? 'Relates to' : 'Unknown'}:</span> {linked.issue_key}: {linked.summary}
                                </Link>
                                {canDelete && ( // Assuming project admin can remove any link
                                    <button
                                        onClick={() => handleRemoveLink(linked.id)} // Need to send link_id to backend
                                        className="text-red-500 hover:text-red-700 ml-2"
                                        title="Remove link"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"></path></svg>
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-500">No linked issues yet.</p>
                )}
                 {canEditIssue && (
                    <button
                        onClick={() => setDialogStateLinkIssue(true)}
                        className="mt-4 px-4 py-2 text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
                    >
                        Link Issue
                    </button>
                 )}
            </div>

            {/* Activity/Comments */}
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Activity</h3>
              <div className="space-y-6">
                {hasActivity ? (
                  issue_details.activity_log
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) // Ensure chronological order
                    .filter(entry => entry.comment?.deleted_at === null || entry.action_type !== 'comment_added') // Hide soft-deleted comments from log
                    .map(entry => (
                      <div key={entry.id} className="flex space-x-4">
                        <div className="flex-shrink-0">
                          {entry.user.profile_picture_url ? (
                            <img src={entry.user.profile_picture_url} alt={getUserInitials(entry.user)} className="w-9 h-9 rounded-full" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-gray-300 flex items-center justify-center text-sm text-gray-700">
                              {getUserInitials(entry.user)}
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-baseline space-x-2">
                            <span className="font-semibold text-gray-900">{entry.user.first_name} {entry.user.last_name}</span>
                            <span className="text-xs text-gray-500">{formatDateTime(entry.created_at)}</span>
                            {entry.action_type === 'comment_edited' && <span className="text-xs text-gray-500 italic">(edited)</span>}
                          </div>
                          {/* Render different activity types */}
                          {entry.action_type === 'comment_added' && entry.comment && entry.comment.deleted_at === null && (
                            <div className="bg-gray-100 p-3 rounded-lg mt-1 relative">
                              <div className="prose max-w-none text-gray-800">
                                {is_edit_active_for_comments[entry.comment.id] ? (
                                    <>
                                        <textarea
                                            value={edit_comment_input_value[entry.comment.id] || ''}
                                            onChange={(e) => setEditCommentInputValue(prev => ({ ...prev, [entry.comment!.id]: e.target.value }))}
                                            className="w-full p-2 border rounded-md resize-y min-h-[80px]"
                                        ></textarea>
                                        <div className="flex justify-end space-x-2 mt-2">
                                            <button onClick={() => handleCancelEditComment(entry.comment!.id)} className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300">Cancel</button>
                                            <button onClick={() => handleEditComment(entry.comment!.id)} className="px-3 py-1 text-sm rounded bg-blue-500 text-white hover:bg-blue-600">Save</button>
                                        </div>
                                    </>
                                ) : (
                                    renderMarkdownWithMentions(entry.comment.content)
                                )}
                              </div>
                              {/* Edit/Delete Icons for comments */}
                              { (entry.user.id === authenticated_user?.id || isProjectAdmin) && entry.comment.deleted_at === null && !is_edit_active_for_comments[entry.comment.id] && (
                                <div className="absolute top-2 right-2 flex space-x-1">
                                  <button
                                    onClick={() => handleEditComment(entry.comment!.id)}
                                    className="text-gray-400 hover:text-blue-600"
                                    title="Edit comment"
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 11C15 5.5v1.293l-7 7L4 14l1.293-4.293 7-7zM15 7l-3-3 2-2 3 3-2 2z"></path></svg>
                                  </button>
                                  <button
                                    onClick={() => handleDeleteComment(entry.comment!.id)}
                                    className="text-gray-400 hover:text-red-500"
                                    title="Delete comment"
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1z" clipRule="evenodd"></path></svg>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          {(entry.action_type !== 'comment_added' || entry.comment?.deleted_at !== null) && (
                              <p className="text-gray-700 mt-1">
                                  {entry.action_type === 'issue_created' && `created this issue.`}
                                  {entry.action_type === 'status_changed' && `changed status from "${entry.old_value}" to "${entry.new_value}".`}
                                  {entry.action_type === 'assignee_changed' && (entry.new_value ? `assigned this issue to ${entry.new_value}.` : `unassigned this issue.`)}
                                  {entry.action_type === 'priority_changed' && `changed priority from "${entry.old_value}" to "${entry.new_value}".`}
                                  {entry.action_type === 'due_date_changed' && `set due date to ${entry.new_value ? formatDateTime(entry.new_value) : 'none'}.`}
                                  {entry.action_type === 'summary_updated' && `updated summary from "${entry.old_value}" to "${entry.new_value}".`}
                                  {entry.action_type === 'description_updated' && `updated the description.`}
                                  {entry.action_type === 'label_added' && `added label "${entry.new_value}".`}
                                  {entry.action_type === 'label_removed' && `removed label "${entry.old_value}".`}
                                  {entry.action_type === 'attachment_added' && `attached file "${entry.new_value}".`}
                                  {entry.action_type === 'attachment_removed' && `removed attachment "${entry.old_value}".`}
                                  {entry.action_type === 'issue_linked' && `linked issue ${entry.new_value}.`}
                                  {entry.action_type === 'issue_unlinked' && `unlinked issue ${entry.old_value}.`}
                                  {entry.action_type === 'subtask_created' && `created sub-task "${entry.new_value}".`}
                                  {entry.comment?.deleted_at !== null && entry.action_type === 'comment_deleted' && `deleted a comment.`}
                              </p>
                          )}
                        </div>
                      </div>
                    ))
                ) : (
                  <p className="text-gray-500 text-center">No activity yet.</p>
                )}
              </div>

              {/* Comment Input */}
              <div className="mt-8">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Add Comment</h3>
                <textarea
                  className="w-full p-3 border border-gray-300 rounded-md resize-y min-h-[120px] focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Add a comment... (Markdown supported, e.g., **bold**, *italic*, `code`, @mention)"
                  value={current_comment_input_value}
                  onChange={(e) => setCurrentCommentInputValue(e.target.value)}
                  disabled={addCommentMutation.isPending}
                ></textarea>
                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleAddComment}
                    className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    disabled={addCommentMutation.isPending || !current_comment_input_value.trim()}
                  >
                    {addCommentMutation.isPending ? 'Adding...' : 'Add Comment'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Key Details */}
        <div className="md:col-span-1">
          <div className="bg-gray-50 p-4 rounded-lg shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Details</h3>

            {/* Project */}
            <div>
              <span className="block text-sm font-medium text-gray-600">Project</span>
              <span className="text-gray-800 flex items-center">
                <Link to={`/projects/${issue_details.project_summary.project_key}/issues`} className="text-blue-600 hover:underline">
                  {issue_details.project_summary.project_name} ({issue_details.project_summary.project_key})
                </Link>
              </span>
            </div>

            {/* Type */}
            <div>
              <span className="block text-sm font-medium text-gray-600">Type</span>
              <span className="text-gray-800">{issue_details.issue_type}</span>
            </div>

            {/* Reporter */}
            <div>
              <span className="block text-sm font-medium text-gray-600">Reporter</span>
              <span className="text-gray-800 flex items-center">
                {issue_details.reporter.profile_picture_url ? (
                  <img src={issue_details.reporter.profile_picture_url} alt={getUserInitials(issue_details.reporter)} className="w-6 h-6 rounded-full mr-2" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-sm text-gray-700 mr-2">
                    {getUserInitials(issue_details.reporter)}
                  </div>
                )}
                {issue_details.reporter.first_name} {issue_details.reporter.last_name}
              </span>
            </div>

            {/* Assignee */}
            <div>
              <span className="block text-sm font-medium text-gray-600">Assignee</span>
              <div className="relative group w-full">
                <select
                  className="w-full border border-gray-300 rounded-md p-2 text-gray-800 appearance-none focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                  value={issue_details.assignee?.id || 'unassigned'}
                  onChange={(e) => handleFieldChange('assignee_user_id', e.target.value === 'unassigned' ? null : e.target.value)}
                  disabled={!canEditIssue || !project_members_all || project_members_all.length === 0}
                >
                  <option value="unassigned">Unassigned</option>
                  {project_members_all?.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.first_name} {member.last_name}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 6.757 7.586 5.343 9z"/></svg>
                </div>
              </div>
            </div>

            {/* Priority */}
            <div>
              <span className="block text-sm font-medium text-gray-600">Priority</span>
              <div className="relative group w-full">
                <select
                  className={`w-full border border-gray-300 rounded-md p-2 appearance-none focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 font-semibold ${getIssuePriorityColor(issue_details.priority)}`}
                  value={issue_details.priority}
                  onChange={(e) => handleFieldChange('priority', e.target.value as IssueDetailedResponse['priority'])}
                  disabled={!canEditIssue}
                >
                  {['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                 <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 6.757 7.586 5.343 9z"/></svg>
                </div>
              </div>
            </div>

            {/* Due Date */}
            <div>
              <span className="block text-sm font-medium text-gray-600">Due Date</span>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-md p-2 text-gray-800 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                value={issue_details.due_date ? format(parseISO(issue_details.due_date), 'yyyy-MM-dd') : ''}
                onChange={(e) => handleFieldChange('due_date', e.target.value || null)}
                disabled={!canEditIssue}
              />
            </div>

            {/* Created / Updated Info */}
            <div className="border-t border-gray-200 pt-4 mt-4 text-sm text-gray-500">
                <p>Created: {formatDateTime(issue_details.created_at)} by {issue_details.reporter.first_name} {issue_details.reporter.last_name}</p>
                <p>Last Updated: {formatDateTime(issue_details.updated_at)}</p> {/* Need to know who updated last from activity log / new_value */}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal (simplified, as GV_GlobalConfirmationModal is not provided as a component) */}
      {show_delete_confirmation && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-red-600">Confirm Deletion</h3>
            <p className="text-gray-800 mb-6">Are you sure you want to delete this {delete_confirm_type}? This action cannot be undone.</p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setShowDeleteConfirmation(false)}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeletion}
                className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Sub-task Modal */}
      {dialog_state_add_subtask && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-blue-600">Add New Sub-task</h3>
            <div className="mb-4">
                <label htmlFor="subtask-summary" className="block text-sm font-medium text-gray-700 mb-1">Summary</label>
                <input
                    type="text"
                    id="subtask-summary"
                    className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    value={new_subtask_summary_input}
                    onChange={(e) => setNewSubtaskSummaryInput(e.target.value)}
                    placeholder="e.g., Update database schema"
                />
            </div>
            <div className="mb-6">
                <label htmlFor="subtask-assignee" className="block text-sm font-medium text-gray-700 mb-1">Assignee</label>
                 <select
                    id="subtask-assignee"
                    className="w-full border border-gray-300 rounded-md p-2 text-gray-800 appearance-none focus:ring-blue-500 focus:border-blue-500"
                    value={new_subtask_assignee_input || 'unassigned'}
                    onChange={(e) => setNewSubtaskAssigneeInput(e.target.value === 'unassigned' ? null : e.target.value)}
                >
                    <option value="unassigned">Unassigned</option>
                    {project_members_all?.map(member => (
                        <option key={member.id} value={member.id}>
                            {member.first_name} {member.last_name}
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setDialogStateAddSubtask(false)}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubTask}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                disabled={addSubTaskMutation.isPending || !new_subtask_summary_input.trim()}
              >
                {addSubTaskMutation.isPending ? 'Adding...' : 'Add Sub-task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Issue Modal */}
      {dialog_state_link_issue && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-blue-600">Link Issue</h3>
            <div className="mb-4">
                <label htmlFor="link-issue-key" className="block text-sm font-medium text-gray-700 mb-1">Issue Key (e.g., WEB-456)</label>
                <input
                    type="text"
                    id="link-issue-key"
                    className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    value={link_issue_target_id_input_value}
                    onChange={(e) => setLinkIssueTargetIdInputValue(e.target.value.toUpperCase())}
                    placeholder="Enter issue key"
                />
            </div>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setDialogStateLinkIssue(false)}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleLinkIssue}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                disabled={linkIssueMutation.isPending || !link_issue_target_id_input_value.trim()}
              >
                {linkIssueMutation.isPending ? 'Linking...' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default UV_IssueDetails;