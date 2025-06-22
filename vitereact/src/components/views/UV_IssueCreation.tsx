import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useAppStore } from '@/store/main';
import { v4 as uuidv4 } from 'uuid'; // For temporary_id in attachments/sub-tasks

// --- Type Definitions ---
// Based on PRD/FRD and Backend OpenAPI & Zustand Schemas

// From Backend: ProjectMemberResponse (contains user_details)
interface ProjectMemberResponse {
  id: string;
  user_id: string;
  project_id: string;
  role: 'Admin' | 'Member';
  user_details: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    profile_picture_url: string | null;
  };
  created_at: string;
  updated_at: string;
}

// Custom for frontend project selection (from globalState.my_projects)
interface ProjectSummaryForSelection {
  id: string;
  project_name: string;
  project_key: string;
}

// Custom for frontend user selection (simple summary)
interface UserSummaryForSelection {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

// For attachments staged for upload (frontend-only)
interface AttachmentUploadStaging {
  rawFile?: File; // The actual file object for uploading
  file_name: string;
  file_url: string; // This will be a temporary URL after pre-upload (e.g., /storage/filename.ext)
  mime_type: string;
  file_size: number;
  status: 'pending_upload' | 'uploading' | 'uploaded' | 'failed';
  temporary_id: string; // Frontend only unique ID for list management
  error_message?: string; // For failed uploads
}

// For sub-tasks during creation (frontend-only)
interface SubTaskCreateRequestExt {
  summary: string;
  assignee_user_id: string | null;
  temporary_id: string;
}

// From OpenAPI: SubTaskCreateRequest (used in final payload)
interface SubTaskCreateRequest {
  summary: string;
  assignee_user_id: string | null;
}

// From OpenAPI: AttachmentUploadRequest (used in final payload)
interface AttachmentUploadRequest {
  file_name: string;
  file_url: string;
  mime_type: string;
  file_size: number;
}

// Frontend payload for IssueCreateRequest - project_id removed as it's a path parameter.
interface IssueCreateRequestPayload {
  issue_type: 'Task' | 'Bug' | 'Story';
  summary: string;
  description?: string;
  assignee_user_id?: string | null;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  due_date?: string | null;
  labels: string[];
  attachments: AttachmentUploadRequest[];
  sub_tasks: SubTaskCreateRequest[];
}

// From Backend: IssueDetailedResponse (expected on successful creation)
interface ProjectSummary {
  id: string;
  project_name: string;
  project_key: string;
}
interface IssueDetailedResponse {
  id: string;
  project_id: string;
  project_summary: ProjectSummary;
  issue_type: 'Task' | 'Bug' | 'Story';
  issue_key: string; // The backend generates this
  summary: string;
  description: string | null;
  assignee: UserSummaryForSelection | null;
  reporter: UserSummaryForSelection;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  status: 'To Do' | 'In Progress' | 'Done';
  due_date: string | null;
  parent_issue_id: string | null;
  rank: number;
  created_at: string;
  updated_at: string;
  labels: { id: string; label_name: string }[];
  attachments: {
    id: string;
    issue_id: string;
    file_name: string;
    file_url: string;
    mime_type: string;
    file_size: number;
    uploaded_by: UserSummaryForSelection;
    created_at: string;
  }[];
  sub_tasks: {
    id: string;
    summary: string;
    assignee: UserSummaryForSelection | null;
    status: 'To Do' | 'In Progress' | 'Done';
    issue_key: string;
  }[];
  linked_issues: {
    id: string;
    issue_key: string;
    summary: string;
    project_key: string;
    link_type: 'relates_to';
  }[];
  activity_log: any[]; // Simplified for this component's scope
}

// Helper to access environment variable for API base URL
const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const UV_IssueCreation: React.FC = () => {
  const { project_key: initial_project_key_slug } = useParams<{ project_key?: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    authenticated_user,
    my_projects,
    set_global_loading,
    add_snackbar_message,
  } = useAppStore();

  // --- Component State ---
  const [selected_project_id, setSelectedProjectId] = useState<string | null>(null);
  const [issue_type_selection, setIssueTypeSelection] = useState<'Task' | 'Bug' | 'Story'>('Task');
  const [summary_input_value, setSummaryInputValue] = useState<string>('');
  const [description_input_value, setDescriptionInputValue] = useState<string>('');
  const [assignee_user_id_selection, setAssigneeUserIdSelection] = useState<string | null>(null);
  const [priority_selection, setPrioritySelection] = useState<'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest'>('Medium');
  const [due_date_selection, setDueDateSelection] = useState<string | null>(null);
  const [labels_input_value, setLabelsInputValue] = useState<string[]>([]);
  const [attachments_list_to_upload, setAttachmentsListToUpload] = useState<AttachmentUploadStaging[]>([]);
  const [sub_tasks_list_to_create, setSubTasksListToCreate] = useState<SubTaskCreateRequestExt[]>([]);
  const [form_error_message, setFormErrorMessage] = useState<string>('');
  const [currentLabelInput, setCurrentLabelInput] = useState<string>(''); // For adding labels

  // Determine available projects for dropdown
  const available_projects_list: ProjectSummaryForSelection[] = my_projects.map(p => ({
    id: p.id,
    project_name: p.project_name,
    project_key: p.project_key,
  }));

  // Resolve initial project from URL slug
  useEffect(() => {
    if (initial_project_key_slug && my_projects.length > 0 && !selected_project_id) {
      const projectFromSlug = my_projects.find(p => p.project_key === initial_project_key_slug);
      if (projectFromSlug) {
        setSelectedProjectId(projectFromSlug.id);
      }
    }
  }, [initial_project_key_slug, my_projects, selected_project_id]);

  // --- Data Fetching: Project Members ---
  const { data: project_members_data, isLoading: isLoadingMembers, error: membersError } = useQuery<ProjectMemberResponse[], Error>({
    queryKey: ['project_members', selected_project_id],
    queryFn: async () => {
      if (!selected_project_id) return []; // Should be disabled if no project selected
      const { data } = await axios.get<ProjectMemberResponse[]>(`${VITE_API_BASE_URL}/api/v1/projects/${selected_project_id}/members`);
      return data;
    },
    enabled: !!selected_project_id, // Only run query if a project is selected
    onSuccess: (data) => {
      // Clear assignee if current one is no longer a member of the newly selected project
      const currentAssigneeExists = data.some(m => m.user_id === assignee_user_id_selection);
      if (assignee_user_id_selection && !currentAssigneeExists) {
        setAssigneeUserIdSelection(null);
      }
      setFormErrorMessage(''); // Clear previous errors related to member fetch
    },
    onError: (err) => {
      setFormErrorMessage(`Failed to load project members: ${err.message}`);
      add_snackbar_message('error', `Failed to load project members: ${err.message}`);
    }
  });

  const project_members_for_assignee_selection: UserSummaryForSelection[] = (
    (project_members_data || []).length > 0 ? project_members_data : []
  ).map(m => ({
    id: m.user_details.id,
    first_name: m.user_details.first_name,
    last_name: m.user_details.last_name,
    profile_picture_url: m.user_details.profile_picture_url,
  }));

  // --- Handlers for Form Fields ---
  const handleProjectSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProjectId(e.target.value);
  };

  const handleLabelsInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentLabelInput(e.target.value);
  };

  const addLabel = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && currentLabelInput.trim() !== '') {
      e.preventDefault(); // Prevent form submission
      setLabelsInputValue(prev => {
        if (!prev.includes(currentLabelInput.trim())) {
          return [...prev, currentLabelInput.trim()];
        }
        return prev;
      });
      setCurrentLabelInput('');
    }
  };

  const removeLabel = (labelToRemove: string) => {
    setLabelsInputValue(prev => prev.filter(label => label !== labelToRemove));
  };


  // --- File Attachment Handlers ---
  // NOTE: This endpoint '/api/v1/files/upload_profile_picture' is used as a generic
  // temporary file upload for MVP as per the VIEW DATAMAP. API OpenAPI spec refers to it
  // as a profile picture upload, which is a potential source of future discrepancy.
  const uploadFileMutation = useMutation<
    { file_url: string },
    Error,
    { rawFile: File; temporary_id: string }
  >({
    mutationFn: async ({ rawFile }) => {
      const formData = new FormData();
      formData.append('file', rawFile);
      const { data } = await axios.post<{ file_url: string }>(
        `${VITE_API_BASE_URL}/api/v1/files/upload_profile_picture`, // Assumed generic file upload endpoint
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      return data;
    },
    onMutate: (newAttachment) => {
      setAttachmentsListToUpload((prev) =>
        prev.map((att) =>
          att.temporary_id === newAttachment.temporary_id
            ? { ...att, status: 'uploading' }
            : att
        )
      );
    },
    onSuccess: (data, variables) => {
      setAttachmentsListToUpload((prev) =>
        prev.map((att) =>
          att.temporary_id === variables.temporary_id
            ? { ...att, file_url: data.file_url, status: 'uploaded' }
            : att
        )
      );
      add_snackbar_message('success', `File "${variables.rawFile.name}" uploaded.`);
    },
    onError: (error, variables) => {
      setAttachmentsListToUpload((prev) =>
        prev.map((att) =>
          att.temporary_id === variables.temporary_id
            ? { ...att, status: 'failed', error_message: error.message }
            : att
        )
      );
      add_snackbar_message('error', `Failed to upload "${variables.rawFile.name}": ${error.message}`);
    },
  });

  const handleFileChange = (files: FileList | null) => {
    if (files) {
      Array.from(files).forEach((file) => {
        const tempId = uuidv4();
        const newAttachment: AttachmentUploadStaging = {
          rawFile: file,
          file_name: file.name,
          file_url: '', // Will be filled after upload
          mime_type: file.type,
          file_size: file.size,
          status: 'pending_upload',
          temporary_id: tempId,
        };
        setAttachmentsListToUpload((prev) => [...prev, newAttachment]);
        uploadFileMutation.mutate({ rawFile: file, temporary_id: tempId });
      });
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50'); // Remove drag-over styles
    handleFileChange(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('border-blue-500', 'bg-blue-50'); // Add drag-over styles
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50'); // Remove drag-over styles
  };

  const handleRemoveAttachment = (tempId: string) => {
    setAttachmentsListToUpload(prev => prev.filter(att => att.temporary_id !== tempId));
  };


  // --- Sub-task Handlers ---
  const handleAddSubTask = () => {
    setSubTasksListToCreate(prev => [
      ...prev,
      { summary: '', assignee_user_id: null, temporary_id: uuidv4() },
    ]);
  };

  const handleSubTaskChange = (tempId: string, field: 'summary' | 'assignee_user_id', value: string) => {
    setSubTasksListToCreate(prev =>
      prev.map(st => (st.temporary_id === tempId ? { ...st, [field]: value } : st))
    );
  };

  const handleRemoveSubTask = (tempId: string) => {
    setSubTasksListToCreate(prev => prev.filter(st => st.temporary_id !== tempId));
  };


  // --- Form Validation ---
  const is_form_valid =
    !!selected_project_id &&
    summary_input_value.trim() !== '' &&
    ['Task', 'Bug', 'Story'].includes(issue_type_selection) &&
    ['Highest', 'High', 'Medium', 'Low', 'Lowest'].includes(priority_selection) &&
    attachments_list_to_upload.every(att => att.status === 'uploaded'); // All attachments must be uploaded

  // --- Issue Creation (Mutation) ---
  const createIssueMutation = useMutation<IssueDetailedResponse, Error, IssueCreateRequestPayload>({
    mutationFn: async (payload) => {
      // project_id is a path parameter, not part of the request payload.
      if (!selected_project_id) {
        throw new Error('Project not selected. Cannot create issue.');
      }
      const url = `${VITE_API_BASE_URL}/api/v1/projects/${selected_project_id}/issues`;
      const token = useAppStore.getState().auth_token; // Get current token
      const {
        project_id: _, // Destructure to exclude project_id from payload specific to IssueCreateRequest type
        ...restPayload // Collect other payload properties
      } = payload; 

      const { data } = await axios.post<IssueDetailedResponse>(url, restPayload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return data;
    },
    onMutate: () => {
      set_global_loading(true);
      setFormErrorMessage('');
    },
    onSuccess: (issue_data) => {
      add_snackbar_message('success', 'Issue created successfully!');
      navigate(`/issues/${issue_data.issue_key}`); // Redirect to the newly created issue
      set_global_loading(false);
    },
    onError: (error) => {
      set_global_loading(false);
      const errorMessage = axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : error.message;
      setFormErrorMessage(`Failed to create issue: ${errorMessage}`);
      add_snackbar_message('error', `Failed to create issue: ${errorMessage}`);
    },
  });

  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!is_form_valid || createIssueMutation.isLoading) {
      setFormErrorMessage('Please fill all required fields and ensure all attachments are uploaded.')
      return;
    }

    const payload: IssueCreateRequestPayload = {
      // project_id is now inferred from `selected_project_id` in the API call's path.
      issue_type: issue_type_selection,
      summary: summary_input_value.trim(),
      description: description_input_value.trim() || undefined,
      assignee_user_id: assignee_user_id_selection,
      priority: priority_selection,
      due_date: due_date_selection || undefined,
      labels: labels_input_value,
      attachments: attachments_list_to_upload
        .filter(att => att.status === 'uploaded')
        .map(att => ({
          file_name: att.file_name,
          file_url: att.file_url,
          mime_type: att.mime_type,
          file_size: att.file_size,
        })),
      sub_tasks: sub_tasks_list_to_create
        .filter(st => st.summary.trim() !== '') // Only include sub-tasks with a summary
        .map(st => ({
          summary: st.summary.trim(),
          assignee_user_id: st.assignee_user_id,
        })),
    };

    createIssueMutation.mutate(payload);
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Create Issue</h1>

      <form onSubmit={handleCreateIssue} className="bg-white p-6 rounded-lg shadow-md space-y-6">
        {/* Project Selection */}
        <div>
          <label htmlFor="project_select" className="block text-sm font-medium text-gray-700 mb-1">
            Project <span className="text-red-500">*</span>
          </label>
          <select
            id="project_select"
            value={selected_project_id || ''}
            onChange={handleProjectSelect}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            required
            disabled={createIssueMutation.isLoading || available_projects_list.length === 0}
          >
            <option value="" disabled>Select a project</option>
            {available_projects_list.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_name} ({project.project_key})
              </option>
            ))}
          </select>
          {selected_project_id && (
            <p className="mt-2 text-xs text-gray-500">
              Selected project members will be available for assignment.
            </p>
          )}
          {!selected_project_id && (
            <p className="mt-2 text-sm text-red-600">Please select a project to proceed.</p>
          )}

        </div>

        {/* Issue Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Issue Type <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 flex space-x-4">
            {['Task', 'Bug', 'Story'].map((type) => (
              <div key={type} className="flex items-center">
                <input
                  id={`issue_type_${type}`}
                  name="issue_type"
                  type="radio"
                  value={type}
                  checked={issue_type_selection === type}
                  onChange={() => setIssueTypeSelection(type as 'Task' | 'Bug' | 'Story')}
                  className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                  disabled={createIssueMutation.isLoading}
                />
                <label htmlFor={`issue_type_${type}`} className="ml-2 block text-sm text-gray-900">
                  {type}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div>
          <label htmlFor="summary" className="block text-sm font-medium text-gray-700 mb-1">
            Summary <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="summary"
            value={summary_input_value}
            onChange={(e) => setSummaryInputValue(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="A concise summary of the issue"
            required
            disabled={createIssueMutation.isLoading}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            rows={6}
            value={description_input_value}
            onChange={(e) => setDescriptionInputValue(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Detailed description of the issue. Markdown is supported (e.g., **bold**, *italics*, - list items, `code`)."
            disabled={createIssueMutation.isLoading}
          ></textarea>
        </div>

        {/* Assignee */}
        <div>
          <label htmlFor="assignee_select" className="block text-sm font-medium text-gray-700 mb-1">
            Assignee
          </label>
          <select
            id="assignee_select"
            value={assignee_user_id_selection || ''}
            onChange={(e) => setAssigneeUserIdSelection(e.target.value || null)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            disabled={createIssueMutation.isLoading || isLoadingMembers || !selected_project_id}
          >
            <option value="">Unassigned</option>
            {project_members_for_assignee_selection.map((member) => (
              <option key={member.id} value={member.id}>
                {member.first_name} {member.last_name}
              </option>
            ))}
             {isLoadingMembers && <option disabled>Loading members...</option>}
          </select>
          {membersError && <p className="mt-2 text-sm text-red-600">Error loading members.</p>}
          {!selected_project_id && (
            <p className="mt-2 text-xs text-gray-500">Select a project to see available assignees.</p>
          )}
        </div>

        {/* Reporter (Read-only) */}
        <div>
          <label htmlFor="reporter" className="block text-sm font-medium text-gray-700 mb-1">
            Reporter
          </label>
          <input
            type="text"
            id="reporter"
            value={`${authenticated_user?.first_name || ''} ${authenticated_user?.last_name || ''} (${authenticated_user?.email || 'N/A'})`}
            className="mt-1 block w-full bg-gray-100 border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm text-gray-700"
            readOnly
          />
        </div>

        {/* Priority */}
        <div>
          <label htmlFor="priority_select" className="block text-sm font-medium text-gray-700 mb-1">
            Priority <span className="text-red-500">*</span>
          </label>
          <select
            id="priority_select"
            value={priority_selection}
            onChange={(e) => setPrioritySelection(e.target.value as typeof priority_selection)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            required
            disabled={createIssueMutation.isLoading}
          >
            {['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>

        {/* Due Date */}
        <div>
          <label htmlFor="due_date" className="block text-sm font-medium text-gray-700 mb-1">
            Due Date
          </label>
          <input
            type="date"
            id="due_date"
            value={due_date_selection || ''}
            onChange={(e) => setDueDateSelection(e.target.value || null)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            disabled={createIssueMutation.isLoading}
          />
        </div>

        {/* Labels */}
        {/* NOTE: This implementation currently only supports adding new labels. The requirement
                   to 'search existing labels' for selection is not yet implemented. */}
        <div>
          <label htmlFor="labels_input" className="block text-sm font-medium text-gray-700 mb-1">
            Labels
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {labels_input_value.map((label) => (
              <span key={label} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {label}
                <button
                  type="button"
                  onClick={() => removeLabel(label)}
                  className="flex-shrink-0 ml-1.5 h-3 w-3 rounded-full inline-flex items-center justify-center text-blue-400 hover:bg-blue-200 hover:text-blue-500 focus:outline-none focus:bg-blue-500 focus:text-white"
                  disabled={createIssueMutation.isLoading}
                >
                  <span className="sr-only">Remove label</span>
                  <svg className="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            id="labels_input"
            value={currentLabelInput}
            onChange={handleLabelsInput}
            onKeyDown={addLabel}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Type label and press Enter"
            disabled={createIssueMutation.isLoading}
          />
        </div>

        {/* Attachments Section */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
          <div
            className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md cursor-pointer hover:border-gray-400 transition-colors"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="space-y-1 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 0 0-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-4H12"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="flex text-sm text-gray-600">
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500">
                Any file type (max 10MB per file)
              </p>
            </div>
            <input
              id="file-upload"
              name="file-upload"
              type="file"
              className="sr-only"
              ref={fileInputRef}
              multiple
              onChange={(e) => handleFileChange(e.target.files)}
              disabled={createIssueMutation.isLoading}
            />
          </div>
          {attachments_list_to_upload.length > 0 && (
            <ul className="mt-4 border border-gray-200 rounded-md divide-y divide-gray-200">
              {attachments_list_to_upload.map((att) => (
                <li key={att.temporary_id} className="pl-3 pr-4 py-3 flex items-center justify-between text-sm">
                  <div className="w-0 flex-1 flex items-center">
                    <svg className="flex-shrink-0 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                        <polyline points="13 2 13 9 20 9"></polyline>
                    </svg>
                    <span className="ml-2 flex-1 w-0 truncate">{att.file_name}</span>
                    <span className={`ml-2 text-xs font-medium ${
                        att.status === 'uploading' ? 'text-blue-500' :
                        att.status === 'uploaded' ? 'text-green-600' :
                        att.status === 'failed' ? 'text-red-600' : 'text-gray-500'
                    }`}>
                        {att.status === 'uploading' && 'Uploading...'}
                        {att.status === 'uploaded' && 'Uploaded'}
                        {att.status === 'failed' && 'Failed'}
                        {att.status === 'pending_upload' && 'Pending...'}
                    </span>
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.temporary_id)}
                      className="font-medium text-red-600 hover:text-red-900 ml-2"
                      disabled={createIssueMutation.isLoading || att.status === 'uploading'}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sub-tasks Section */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sub-tasks
          </label>
          {sub_tasks_list_to_create.map((subTask, index) => (
            <div key={subTask.temporary_id} className="flex items-center space-x-2 mb-2 p-2 bg-gray-50 rounded-md">
              <input
                type="text"
                value={subTask.summary}
                onChange={(e) => handleSubTaskChange(subTask.temporary_id, 'summary', e.target.value)}
                className="flex-1 border border-gray-300 rounded-md shadow-sm py-1.5 px-2 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Sub-task summary"
                required
                disabled={createIssueMutation.isLoading}
              />
              <select
                value={subTask.assignee_user_id || ''}
                onChange={(e) => handleSubTaskChange(subTask.temporary_id, 'assignee_user_id', e.target.value || '')}
                className="w-48 pl-2 pr-8 py-1.5 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                disabled={createIssueMutation.isLoading || isLoadingMembers || !selected_project_id}
              >
                <option value="">Unassigned</option>
                {project_members_for_assignee_selection.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleRemoveSubTask(subTask.temporary_id)}
                className="p-1 text-red-500 hover:text-red-700"
                disabled={createIssueMutation.isLoading}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddSubTask}
            className="mt-2 inline-flex items-center px-3 py-1.5 border border-transparent text-sm leading-4 font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={createIssueMutation.isLoading || !selected_project_id}
          >
            Add Sub-task
          </button>
        </div>

        {/* Error Message */}
        {form_error_message && (
          <p className="text-red-600 text-sm mt-4">{form_error_message}</p>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 mt-6">
          <Link
            to={selected_project_id ? `/projects/${my_projects.find(p => p.id === selected_project_id)?.project_key}/issues` : '/dashboard'}
            // Use window.history.back() for proper modal dismiss behavior if this was in a modal
            onClick={(e) => {
                const prevPath = localStorage.getItem('previous_path');
                if (prevPath && prevPath.startsWith('/projects/') ) {
                    e.preventDefault();
                    navigate(-1); // Go back one step in history
                }
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
              is_form_valid && !createIssueMutation.isLoading
                ? 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                : 'bg-blue-400 cursor-not-allowed'
            }`}
            disabled={!is_form_valid || createIssueMutation.isLoading}
          >
            {createIssueMutation.isLoading ? (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.962l2-2.671zm8 2.671A7.962 7.962 0 0120 12h4c0 3.042-1.135 5.824-3 7.962l-2-2.671z"></path>
              </svg>
            ) : null}
            Create
          </button>
        </div>
      </form>
    </div>
  );
};

export default UV_IssueCreation;