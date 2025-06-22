import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { useAppStore } from '@/store/main';
import ReactMarkdown from 'react-markdown'; // For markdown preview/rendering

// Define interfaces based on OpenAPI spec and PRD
interface UserSummary {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

interface ProjectCreatePayload {
  project_name: string;
  project_key: string;
  description?: string;
  project_lead_user_id: string;
}

// Based on ProjectResponse from OpenAPI, ensuring project_name is available for snackbar
interface ProjectCreationResponse {
  id: string;
  project_name: string;
  project_key: string;
  description?: string | null;
  // Others properties from ProjectResponse can be added if needed downstream
}

// --- API Calls ---

const VITE_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';

const fetchAllUsers = async (): Promise<UserSummary[]> => {
  const { data } = await axios.get<UserSummary[]>(`${VITE_API_BASE_URL}/api/v1/users`);
  return data;
};

const createProject = async (payload: ProjectCreatePayload): Promise<ProjectCreationResponse> => {
  const { data } = await axios.post<ProjectCreationResponse>(`${VITE_API_BASE_URL}/api/v1/projects`, payload);
  return data;
};

// --- Helper Functions ---

/**
 * Generates a project key from a project name.
 * Attempts to extract uppercase letters first, then first letters of words,
 * and finally alphanumeric characters, limited to 10 and uppercase.
 * @param projectName The input project name.
 * @returns A generated project key.
 */
const generateProjectKey = (projectName: string): string => {
  if (!projectName) {
    return '';
  }

  // Attempt 1: Extract all consecutive uppercase English letters.
  // This helps with "Website Redesign" -> "WR" or "AetherFlow Core Platform" -> "AFCP"
  let key = projectName.match(/[A-Z]/g)?.join('') || '';

  // Attempt 2: If no or few uppercase letters, take the first letter of each word.
  // A threshold to fallback if not enough distinct uppercase chars are found.
  if (key.length < 3) { // A threshold to fall back to first letters if not enough uppercase are found.
    key = projectName.split(/\s+/) // Split by one or more spaces
                     .map(word => (word.length > 0 ? word.charAt(0).toUpperCase() : ''))
                     .filter(char => /[A-Z0-9]/.test(char)) // Keep only alphanumeric chars
                     .join('');
  }

  // Attempt 3: If still empty (e.g., name starts with non-alphanumeric, or all lowercase words),
  // take first 10 alphanumeric chars from the whole project name.
  if (key.length === 0) {
    key = projectName.replace(/[^A-Za-z0-9]/g, '').substring(0, 10).toUpperCase();
  }
  
  // Ensure the key is trimmed to max 10 characters and is uppercase alphanumeric.
  // This final clean-up step ensures consistency, especially for cases where initial logic might miss non-alphanumeric.
  return key.substring(0, Math.min(key.length, 10)).replace(/[^A-Z0-9]/g, '');
};


/**
 * Validates the format of a project key.
 * @param key The project key to validate.
 * @returns An error message string if invalid, otherwise null.
 */
const validateProjectKeyFormat = (key: string): string | null => {
  if (!key) {
    return 'Project key is required.';
  }
  // Max length is 10 based on OpenAPI ProjectCreateRequest schema
  if (!/^[A-Z0-9]{1,10}$/.test(key)) {
    return 'Key must be 1-10 uppercase alphanumeric characters.';
  }
  return null;
};

/**
 * React functional component for the Project Creation view.
 */
const UV_ProjectCreation: React.FC = () => {
  const navigate = useNavigate();
  const { authenticated_user, add_snackbar_message, set_global_loading } = useAppStore();

  // --- State Variables ---
  const [project_name_input_value, set_project_name_input_value] = useState<string>('');
  const [project_key_input_value, set_project_key_input_value] = useState<string>('');
  const [is_project_key_dirty, set_is_project_key_dirty] = useState<boolean>(false); // Tracks if user manually edited key
  const [description_input_value, set_description_input_value] = useState<string>('');
  const [project_lead_user_id_selection, set_project_lead_user_id_selection] = useState<string>(authenticated_user?.id || '');
  const [project_key_validation_error, set_project_key_validation_error] = useState<string | null>(null);
  const [form_error_message, set_form_error_message] = useState<string | null>(null);

  // --- Fetching Users for Lead Selection ---
  // This useQuery assumes the existence of the conceptual /api/v1/users/all endpoint.
  const { 
    data: all_users_for_lead_selection, 
    isLoading: is_users_loading, 
    isError: is_users_error, 
    error: users_fetch_error 
  } = useQuery<UserSummary[], Error>({
    queryKey: ['allUsersForLead'],
    queryFn: fetchAllUsers,
    staleTime: 1000 * 60 * 5, // Users list can be stale for 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // --- Auto-generate Project Key based on Project Name ---
  useEffect(() => {
    if (!is_project_key_dirty) {
      set_project_key_input_value(generateProjectKey(project_name_input_value));
    }
  }, [project_name_input_value, is_project_key_dirty]);

  // --- Validate Project Key Format on Change ---
  useEffect(() => {
    // Validate only if the input has content or has been manually edited
    if (project_key_input_value.length > 0 || is_project_key_dirty) {
      set_project_key_validation_error(validateProjectKeyFormat(project_key_input_value));
    } else {
      set_project_key_validation_error(null); // Clear error if input is empty and not dirty
    }
  }, [project_key_input_value, is_project_key_dirty]);

  // --- Project Creation Mutation ---
  const createProjectMutation = useMutation<ProjectCreationResponse, AxiosError<{ message?: string }>, ProjectCreatePayload>({
    mutationFn: createProject,
    onMutate: () => {
      set_global_loading(true); // Set global loading indicator
      set_form_error_message(null); // Clear previous form errors
    },
    onSuccess: (data) => {
      add_snackbar_message('success', `Project "${data.project_name}" created successfully!`);
      // Use the new project's key for navigation as per sitemap requirements
      navigate(`/projects/${data.project_key}/board`); 
    },
    onError: (error) => {
      const errorMessage = error.response?.data?.message || 'Failed to create project due to an unexpected error.';
      set_form_error_message(errorMessage);
      add_snackbar_message('error', errorMessage);
      console.error('Project creation error:', error);
    },
    onSettled: () => {
      set_global_loading(false); // Reset global loading indicator
    },
  });

  // --- Form Validity Check ---
  const is_form_valid = useMemo(() => {
    const is_name_valid = project_name_input_value.trim().length > 0;
    const is_key_present = project_key_input_value.trim().length > 0;
    const is_key_format_valid = !project_key_validation_error; // No validation error implies format is correct
    // Ensure project lead is selected and users are loaded (if not, it indicates a problem). 
    // If users are still loading or have errored, the form is not valid for submission.
    const is_lead_selected = project_lead_user_id_selection.length > 0 && !is_users_loading && !is_users_error;
    
    // Button should be disabled if any field is invalid or mutation is pending
    return is_name_valid && is_key_present && is_key_format_valid && is_lead_selected && !createProjectMutation.isPending;
  }, [
    project_name_input_value,
    project_key_input_value,
    project_key_validation_error,
    project_lead_user_id_selection,
    is_users_loading,
    is_users_error,
    createProjectMutation.isPending
  ]);

  // --- Handle Form Submission ---
  const handle_submit = (e: React.FormEvent) => {
    e.preventDefault();

    // Re-validate client-side on submit to ensure latest state
    const keyFormatErrorOnSubmit = validateProjectKeyFormat(project_key_input_value);
    set_project_key_validation_error(keyFormatErrorOnSubmit);

    // Check overall form validity, including immediate re-validation results
    if (!is_form_valid || keyFormatErrorOnSubmit) {
      // Only set generic form error message if there are specific field errors
      if (project_name_input_value.trim().length === 0 || project_key_input_value.trim().length === 0 || keyFormatErrorOnSubmit || project_lead_user_id_selection.length === 0) {
        set_form_error_message('Please correct the highlighted errors in the form.');
      } else {
        set_form_error_message(null); // Clear if no obvious errors after re-validation
      }
      return;
    }

    createProjectMutation.mutate({
      project_name: project_name_input_value,
      project_key: project_key_input_value,
      description: description_input_value.trim() || undefined, // Send undefined if empty
      project_lead_user_id: project_lead_user_id_selection,
    });
  };

  return (
    <>
      <div className="container mx-auto p-6 max-w-2xl bg-white rounded-lg shadow-xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">Create New Project</h1>

        {form_error_message && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline"> {form_error_message}</span>
          </div>
        )}

        <form onSubmit={handle_submit} className="space-y-6">
          {/* Project Name */}
          <div>
            <label htmlFor="project_name" className="block text-sm font-medium text-gray-700 mb-1">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="project_name"
              className={`mt-1 block w-full px-3 py-2 border ${project_name_input_value.trim().length === 0 ? 'border-red-400' : 'border-gray-300'} rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm`}
              placeholder="e.g., Website Redesign"
              value={project_name_input_value}
              onChange={(e) => set_project_name_input_value(e.target.value)}
              required
              aria-invalid={project_name_input_value.trim().length === 0}
              aria-describedby="project-name-error"
            />
            {project_name_input_value.trim().length === 0 && (
              <p id="project-name-error" className="mt-1 text-xs text-red-500">Project name is required.</p>
            )}
          </div>

          {/* Project Key */}
          <div>
            <label htmlFor="project_key" className="block text-sm font-medium text-gray-700 mb-1">
              Project Key <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="project_key"
              className={`mt-1 block w-full px-3 py-2 border ${project_key_validation_error ? 'border-red-400' : 'border-gray-300'} rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm`}
              placeholder="e.g., WEB"
              value={project_key_input_value}
              onChange={(e) => {
                set_project_key_input_value(e.target.value.toUpperCase()); 
                set_is_project_key_dirty(true); 
              }}
              onBlur={() => set_project_key_validation_error(validateProjectKeyFormat(project_key_input_value))}
              required
              aria-invalid={!!project_key_validation_error}
              aria-describedby="project-key-error"
            />
            {project_key_validation_error && (
              <p id="project-key-error" className="mt-1 text-xs text-red-500">{project_key_validation_error}</p>
            )}
            {/* Only show auto-generation hint if key isn't dirty and there's a project name to base it on */}
            {!project_key_validation_error && !is_project_key_dirty && project_name_input_value.trim().length > 0 && (
              <p className="mt-1 text-xs text-gray-500">Auto-generated from Project Name (editable).</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description (Optional)
            </label>
            <textarea
              id="description"
              rows={5}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Provide a detailed description of the project, markdown supported." // Markdown hint
              value={description_input_value}
              onChange={(e) => set_description_input_value(e.target.value)}
            ></textarea>
            {description_input_value.trim().length > 0 && (
              <div className="mt-2 p-3 bg-gray-50 rounded-md text-sm text-gray-700 border border-gray-200">
                <p className="font-semibold mb-1">Preview:</p>
                <ReactMarkdown className="prose prose-sm max-w-none">
                  {description_input_value}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Project Lead */}
          <div>
            <label htmlFor="project_lead" className="block text-sm font-medium text-gray-700 mb-1">
              Project Lead <span className="text-red-500">*</span>
            </label>
            <select
              id="project_lead"
              className={`mt-1 block w-full px-3 py-2 border ${project_lead_user_id_selection === '' ? 'border-red-400' : 'border-gray-300'} rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm`}
              value={project_lead_user_id_selection}
              onChange={(e) => set_project_lead_user_id_selection(e.target.value)}
              required
              disabled={is_users_loading || is_users_error} 
              aria-invalid={project_lead_user_id_selection === ''}
              aria-describedby="project-lead-error"
            >
              {is_users_loading ? (
                <option value="">Loading users...</option>
              ) : is_users_error ? (
                <option value="">Error loading users: {users_fetch_error?.message || 'Check network'}</option>
              ) : (
                <>
                  {/* The 'Select a lead' option is hidden if a project_lead_user_id_selection is already set (e.g., defaulted to authenticated user) */}
                  <option value="" disabled={project_lead_user_id_selection !== ''} hidden={project_lead_user_id_selection !== ''}>Select a lead</option>
                  {all_users_for_lead_selection?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.first_name} {user.last_name} {user.id === authenticated_user?.id ? '(Me)' : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
            {project_lead_user_id_selection.length === 0 && (
              <p id="project-lead-error" className="mt-1 text-xs text-red-500">Project lead is required.</p>
            )}
            {is_users_loading && (
              <p className="mt-1 text-xs text-gray-500">Fetching available users...</p>
            )}
            {is_users_error && (
              <p className="mt-1 text-xs text-red-500">Failed to load users for selection. Please try refreshing.</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 mt-8">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!is_form_valid}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 
                ${!is_form_valid 
                  ? 'bg-blue-300 cursor-not-allowed' 
                  : (createProjectMutation.isPending ? 'bg-blue-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-700')
                }`}
            >
              {createProjectMutation.isPending ? 'Creating Project...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default UV_ProjectCreation;