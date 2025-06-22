import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore, api_client } from '@/store/main'; // Assuming api_client is globally exported and configured with token interceptors
import { AxiosError } from 'axios';
import { Dialog, Transition } from '@headlessui/react';
import { UserPlusIcon, TrashIcon } from '@heroicons/react/24/outline'; // Removed UserMinusIcon

// --- Type Definitions ---

// User details response from /api/v1/users/me
interface UserResponse {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

// Project Role type
type ProjectRole = "Admin" | "Member";

// Project member response from /api/v1/projects/:project_id/members
interface ProjectMemberResponse {
  id: string; // This is the project_member_record_id (not user_id)
  user_id: string;
  project_id: string;
  role: ProjectRole;
  user_details: UserResponse;
  created_at: string; // ISO 8601 datetime string
  updated_at: string; // ISO 8601 datetime string
}
type ProjectMembersList = ProjectMemberResponse[];

// User summary for search results
interface UserSummary {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}
type UserSearchResults = UserSummary[];

// --- Constants ---
const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// --- Custom Hook: useDebounce ---
// Simple debounce hook for search inputs
const useDebounce = <T>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};


const UV_ProjectSettingsMembers: React.FC = () => {
  const { project_key } = useParams<{ project_key: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { my_projects, authenticated_user, add_snackbar_message } = useAppStore();

  const currentProject = useMemo(() => {
    return my_projects.find(p => p.project_key === project_key);
  }, [my_projects, project_key]);

  const project_id = currentProject?.id;
  const current_user_role_in_project = currentProject?.user_role;
  const is_current_user_project_admin = current_user_role_in_project === 'Admin';

  // --- State for Add Member Modal ---
  const [is_add_member_modal_open, set_is_add_member_modal_open] = useState(false);
  const [user_search_value, set_user_search_value] = useState('');
  const debounced_user_search_value = useDebounce(user_search_value, 500); // Debounce search input

  // --- State for Remove Member Confirmation ---
  const [show_remove_confirmation_modal, set_show_remove_confirmation_modal] = useState(false);
  const [member_to_remove, set_member_to_remove] = useState<ProjectMemberResponse | null>(null);

  // --- API Client from Zustand Store ---
  // A pattern to get the axios instance with auth headers configured by the Zustand store
  const getApiClient = useCallback(() => {
    // Assuming the store's `_initialize_axios_and_socket` also makes `api_client` globally available or via a getter
    // For this implementation, we will use a fresh axios instance and rely on the fact that
    // the global store sets default headers for it. This is a common pattern when global Zustand store manages Axios defaults.
    // If it's not a singleton set up by the store, you'd need to pass the axios instance explicitly from the store.
    return axios.create({
      baseURL: VITE_API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authenticated_user?.id ? useAppStore.getState().auth_token : ''}` // Ensure token is passed
      }
    });
  }, [authenticated_user?.id]);


  // Effect to redirect if project is not found or user is not an admin (redundant with App.tsx but good for component robustness)
  useEffect(() => {
    if (!currentProject && project_key) {
      add_snackbar_message('error', `Project with key "${project_key}" not found or you don't have access.`);
      navigate('/dashboard'); // Or some fallback route
    } else if (!is_current_user_project_admin) {
        add_snackbar_message('error', `You must be a Project Admin to manage members.`);
        navigate(`/projects/${project_key}/board`); // Redirect to project board if not admin
    }
  }, [currentProject, project_key, is_current_user_project_admin, navigate, add_snackbar_message]);

  // --- React Query: Fetch Project Members ---
  const fetchProjectMembers = async (): Promise<ProjectMembersList> => {
    const { data } = await api_client.get<ProjectMembersList>(`/api/v1/projects/${project_id}/members`);
    return data;
  };

  const { data: project_members_list, isLoading: is_members_loading, isError: is_members_error, error: members_error } = useQuery<ProjectMembersList, AxiosError>({
    queryKey: ['project_members', project_id],
    queryFn: fetchProjectMembers,
    enabled: !!project_id && is_current_user_project_admin, // Only fetch if project_id is available and user is admin
    onError: (err) => {
      // Specific 403 handling can be here, but also relies on global route protection in App.tsx
      // if (err.response?.status === 403) {
      //   navigate(`/projects/${project_key}/board`);
      //   add_snackbar_message('error', 'You do not have permission to view project members.');
      // } else {
        add_snackbar_message('error', `Failed to load members: ${(err.response?.data as { message: string })?.message || err.message}`);
      // }
    }
  });

  // --- React Query: Search Users to Add ---
  const searchUsers = async (query: string): Promise<UserSearchResults> => {
    const { data } = await api_client.get<UserSearchResults>(`/api/v1/users/search?query=${query}`);
    return data;
  };

  const { data: users_for_add_member_search_results, isLoading: is_search_loading } = useQuery<UserSearchResults, AxiosError>({
    queryKey: ['user_search', debounced_user_search_value],
    queryFn: () => searchUsers(debounced_user_search_value),
    enabled: is_add_member_modal_open && !!debounced_user_search_value && debounced_user_search_value.length >= 2, // Only enabled when modal is open and query is long enough
    staleTime: 5 * 60 * 1000 // Cache search results
  });

  const filtered_search_results_for_modal = useMemo(() => {
    if (!users_for_add_member_search_results || !project_members_list) return [];
    // Filter out users who are already members of the project
    return users_for_add_member_search_results.filter(
      (user) => !project_members_list.some((member) => member.user_id === user.id)
    );
  }, [users_for_add_member_search_results, project_members_list]);

  // --- React Query: Add Project Member Mutation ---
  const addMemberMutation = useMutation<ProjectMemberResponse, AxiosError, { user_id: string }>({
    mutationFn: async (payload) => {
      const { data } = await api_client.post<ProjectMemberResponse>(`/api/v1/projects/${project_id}/members`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project_members', project_id] });
      add_snackbar_message('success', 'Member added successfully!');
      set_is_add_member_modal_open(false);
      set_user_search_value(''); // Clear search input
    },
    onError: (err) => {
      add_snackbar_message('error', `Failed to add member: ${(err.response?.data as { message: string })?.message || err.message}`);
    }
  });

  // --- React Query: Update Project Member Role Mutation ---
  const updateRoleMutation = useMutation<ProjectMemberResponse, AxiosError, { member_db_id: string; new_role: ProjectRole }>({
    mutationFn: async (payload) => {
      const { data } = await api_client.put<ProjectMemberResponse>(`/api/v1/projects/${project_id}/members/${payload.member_db_id}`, { role: payload.new_role });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project_members', project_id] });
      add_snackbar_message('success', 'Member role updated successfully!');
    },
    onError: (err) => {
      const message = (err.response?.data as { message: string })?.message || err.message;
      if (message.includes('Cannot remove the sole Project Admin')) {
        add_snackbar_message('error', 'Cannot demote the sole project admin.');
      } else {
        add_snackbar_message('error', `Failed to update role: ${message}`);
      }
    },
    onSettled: () => {
        // Invalidate 'my_projects' to reflect potential changes in the current user's role
        queryClient.invalidateQueries({ queryKey: ['my_projects'] });
    }
  });

  // --- React Query: Remove Project Member Mutation ---
  const removeMemberMutation = useMutation<void, AxiosError, string>({
    mutationFn: async (member_db_id) => {
      await api_client.delete<void>(`/api/v1/projects/${project_id}/members/${member_db_id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project_members', project_id] });
      add_snackbar_message('success', 'Member removed successfully.');
      set_show_remove_confirmation_modal(false);
      set_member_to_remove(null);
    },
    onError: (err) => {
      const message = (err.response?.data as { message: string })?.message || err.message;
      if (message.includes('Cannot remove the sole Project Admin')) {
        add_snackbar_message('error', 'Cannot remove the sole project admin.');
      } else if (message.includes('Cannot remove Project Lead')) {
         add_snackbar_message('error', 'Cannot remove project lead if no other member found to replace.');
      } else {
        add_snackbar_message('error', `Failed to remove member: ${message}`);
      }
    },
    onSettled: () => {
        // Invalidate 'my_projects' to reflect potential changes in the current user's membership (if they removed themselves)
        queryClient.invalidateQueries({ queryKey: ['my_projects'] });
    }
  });

  // --- Helper Functions ---
  const handle_remove_click = (member: ProjectMemberResponse) => {
    const admin_count = (project_members_list || []).filter(pm => pm.role === 'Admin').length;
    const is_sole_admin = member.role === 'Admin' && admin_count === 1;

    if (is_sole_admin || (member.user_id === authenticated_user?.id && is_sole_admin)) {
      add_snackbar_message('error', 'Cannot remove the sole Project Admin from the project.');
      return;
    }

    set_member_to_remove(member);
    set_show_remove_confirmation_modal(true);
  };

  const handle_confirm_remove = () => {
    if (member_to_remove) {
      removeMemberMutation.mutate(member_to_remove.id);
    }
  };

  const handle_change_role = (member: ProjectMemberResponse, new_role: ProjectRole) => {
      const admin_count = (project_members_list || []).filter(pm => pm.role === 'Admin').length;
      const is_sole_admin = member.role === 'Admin' && admin_count === 1;

      if (is_sole_admin && new_role === 'Member') {
          add_snackbar_message('error', 'Cannot demote the sole Project Admin.');
          return;
      }
      updateRoleMutation.mutate({ member_db_id: member.id, new_role });
  };

  // Render nothing if project is not found or loading, prevents errors
  if (!project_id || is_members_loading || !is_current_user_project_admin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-theme(spacing.16))]">
        <svg className="animate-spin h-10 w-10 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="mt-4 text-lg text-gray-700">Loading project members...</p>
      </div>
    );
  }

  // Handle member list errors
  if (is_members_error) {
    return (
      <div className="text-red-600 p-4 bg-red-100 border border-red-200 rounded-md">
        <p>Error: {members_error?.message || 'Could not load project members.'}</p>
        <p>Please check your network connection or try again later.</p>
      </div>
    );
  }

  return (
    <>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          Project Settings: {currentProject?.project_name}{' '}
          <span className="text-gray-500 text-xl font-normal">({currentProject?.project_key})</span>
        </h1>

        {/* Navigation Tabs */}
        <nav className="flex space-x-4 border-b border-gray-200 mb-8">
          <Link
            to={`/projects/${project_key}/settings/details`}
            className="px-4 py-2 text-md font-medium text-gray-600 hover:text-blue-600 hover:border-blue-600 border-b-2 border-transparent transition-colors duration-200"
          >
            Details
          </Link>
          <Link
            to={`/projects/${project_key}/settings/members`}
            className="px-4 py-2 text-md font-bold text-blue-600 border-b-2 border-blue-600"
          >
            Members
          </Link>
        </nav>

        {/* Add Member Button */}
        <div className="flex justify-end mb-6">
          <button
            onClick={() => set_is_add_member_modal_open(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={addMemberMutation.isLoading}
          >
            <UserPlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
            Add Members
          </button>
        </div>

        {/* Project Members Table */}
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Project Role
                </th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {project_members_list?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    No members in this project yet.
                  </td>
                </tr>
              ) : (
                project_members_list?.map((member) => (
                  <tr key={member.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      <div className="flex items-center">
                        {member.user_details.profile_picture_url ? (
                          <img
                            className="h-8 w-8 rounded-full object-cover mr-3"
                            src={member.user_details.profile_picture_url}
                            alt={`${member.user_details.first_name} ${member.user_details.last_name}`}
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center mr-3 text-sm font-semibold text-gray-700">
                            {member.user_details.first_name?.[0]}{member.user_details.last_name?.[0]}
                          </div>
                        )}
                        {member.user_details.first_name} {member.user_details.last_name}
                    </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {member.user_details.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <select
                        value={member.role}
                        onChange={(e) => handle_change_role(member, e.target.value as ProjectRole)}
                        className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        disabled={!is_current_user_project_admin || updateRoleMutation.isLoading || (member.user_id === authenticated_user?.id && member.role === 'Admin' && (project_members_list?.filter(pm => pm.role === 'Admin').length || 0) === 1)}
                      >
                        <option value="Admin">Admin</option>
                        <option value="Member">Member</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handle_remove_click(member)}
                        className="text-red-600 hover:text-red-900 ml-4 p-1 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                        disabled={!is_current_user_project_admin || removeMemberMutation.isLoading}
                      >
                        <TrashIcon className="h-5 w-5" />
                        <span className="sr-only">Remove {member.user_details.first_name}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Member Modal */}
      <Transition appear show={is_add_member_modal_open} as={React.Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => set_is_add_member_modal_open(false)}>
          <Transition.Child
            as={React.Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={React.Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-950 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900 mb-4">
                    Add New Project Members
                  </Dialog.Title>
                  <div className="mt-2">
                    <input
                      type="text"
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder="Search users by name or email..."
                      value={user_search_value}
                      onChange={(e) => set_user_search_value(e.target.value)}
                    />
                    {is_search_loading && (
                      <p className="mt-2 text-sm text-gray-500">Searching...</p>
                    )}
                    <ul className="mt-3 max-h-60 overflow-y-auto border border-gray-200 rounded-md">
                      {filtered_search_results_for_modal.length === 0 && debounced_user_search_value.length >= 2 && !is_search_loading ? (
                        <li className="px-4 py-2 text-sm text-gray-500">No users found or all users already members.</li>
                      ) : (
                        filtered_search_results_for_modal.map((user) => (
                          <li key={user.id} className="px-4 py-3 border-b border-gray-200 last:border-b-0 flex items-center justify-between">
                            <div className="flex items-center">
                               {user.profile_picture_url ? (
                                    <img
                                        className="h-8 w-8 rounded-full object-cover mr-3"
                                        src={user.profile_picture_url}
                                        alt={`${user.first_name} ${user.last_name}`}
                                    />
                                ) : (
                                    <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center mr-3 text-sm font-semibold text-gray-700">
                                        {user.first_name?.[0]}{user.last_name?.[0]}
                                    </div>
                                )}
                              <span className="text-sm font-medium text-gray-900">
                                {user.first_name} {user.last_name}
                              </span>
                            </div>
                            <button
                              onClick={() => addMemberMutation.mutate({ user_id: user.id })}
                              className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              disabled={addMemberMutation.isLoading}
                            >
                               {addMemberMutation.isLoading ? 'Adding...' : 'Add'}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-md border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                      onClick={() => set_is_add_member_modal_open(false)}
                    >
                      Close
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Remove Member Confirmation Modal */}
      <Transition appear show={show_remove_confirmation_modal} as={React.Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => set_show_remove_confirmation_modal(false)}>
          <Transition.Child
            as={React.Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={React.Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-950 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                    Remove Member
                  </Dialog.Title>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500">
                      Are you sure you want to remove <strong>{member_to_remove?.user_details.first_name} {member_to_remove?.user_details.last_name}</strong> from this project? This action cannot be undone.
                    </p>
                  </div>

                  <div className="mt-4 flex justify-end gap-x-2">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      onClick={() => set_show_remove_confirmation_modal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                      onClick={handle_confirm_remove}
                      disabled={removeMemberMutation.isLoading}
                    >
                      {removeMemberMutation.isLoading ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
};

export default UV_ProjectSettingsMembers;