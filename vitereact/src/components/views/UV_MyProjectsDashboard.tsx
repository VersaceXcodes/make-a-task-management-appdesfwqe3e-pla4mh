import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAppStore, ProjectListResponse, UserSummary } from '@/store/main';

// --- API Call Function for React Query ---
// This function fetches the list of projects the authenticated user is a member of.
const fetch_projects_api = async (): Promise<ProjectListResponse[]> => {
  const { auth_token } = useAppStore.getState(); // Retrieve the JWT token from the global Zustand store

  // Defensive check: If no auth token is present, throw an error to prevent the API call.
  // The ProtectedRoute in App.tsx should ideally prevent unauthenticated access,
  // but this adds an extra layer of safety for the query.
  if (!auth_token) {
    throw new Error('Authentication token not found. Please log in.');
  }

  try {
    const VITE_API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';
    const response = await axios.get<ProjectListResponse[]>(
      // Construct the API URL using the Vite environment variable
      `${VITE_API_BASE_URL}/api/v1/projects`,
      {
        headers: {
          Authorization: `Bearer ${auth_token}`, // Attach the JWT token for authentication
        },
      }
    );
    return response.data;
  } catch (error) {
    // Standardized error handling for Axios errors
    if (axios.isAxiosError(error) && error.response) {
      // Extract a more descriptive message from the backend response if available
      throw new Error(error.response.data.message || 'Failed to fetch projects.');
    }
    // Generic error message for unexpected issues
    throw new Error('An unexpected error occurred while fetching projects.');
  }
};

/**
 * Helper function to render a user's avatar. Displays an image if `profile_picture_url` is present,
 * otherwise, displays initials within a colored circle.
 * Moved outside the component to prevent re-creation on every render.
 * @param user The UserSummary object containing user details.
 */
const render_user_avatar = (user: UserSummary) => (
  user.profile_picture_url ? (
    <img
      src={user.profile_picture_url}
      alt={`${user.first_name} ${user.last_name}'s avatar`}
      className="w-8 h-8 rounded-full object-cover mr-2"
    />
  ) : (
    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold mr-2">
      {`${user.first_name ? user.first_name.charAt(0) : ''}${user.last_name ? user.last_name.charAt(0) : ''}`.toUpperCase()}
    </div>
  )
);

/**
 * UV_MyProjectsDashboard Component
 * Displays a list of projects the authenticated user is a member of and provides
 * a button to create new projects.
 */
const UV_MyProjectsDashboard: React.FC = () => {
  const navigate = useNavigate(); // Hook for programmatic navigation

  // Access global state from Zustand store
  const {
    authenticated_user, // To check authentication status (implicitly handled by ProtectedRoute, but can be used for logic)
    my_projects, // The current list of projects from global state
    set_global_loading, // Action to update the global loading indicator
    add_snackbar_message, // Action to display snackbar notifications
  } = useAppStore(
    (state) => ({
      authenticated_user: state.authenticated_user,
      my_projects: state.my_projects,
      set_global_loading: state.set_global_loading,
      add_snackbar_message: state.add_snackbar_message,
    })
  );

  // Use @tanstack/react-query to manage the asynchronous fetching of projects
  const {
    data: fetched_projects, // The data returned by fetch_projects_api
    isLoading: query_is_loading, // Automatically true while data is being fetched
    isError: query_is_error, // Automatically true if the query encounters an error
    error: query_error, // The error object if query_is_error is true
    refetch, // Function to manually re-run the query
  } = useQuery<ProjectListResponse[], Error>({
    queryKey: ['my_projects_dashboard'], // Unique key for caching and invalidation
    queryFn: fetch_projects_api, // The function that performs the data fetching
    // The query will only run if the user is authenticated.
    // This allows React Query to skip fetching until `authenticated_user` is not null.
    enabled: !!authenticated_user,
    // Callback executed on successful data fetch
    onSuccess: (data) => {
      // Update the `my_projects` array in the global Zustand store with the fresh data
      useAppStore.setState({ my_projects: data });
      // Removed redundant set_global_loading(false) as useEffect handles this.
    },
    // Callback executed on query error
    onError: (err) => {
      // Display an error message using the global snackbar
      add_snackbar_message('error', `Error loading projects: ${err.message}`);
      // Removed redundant set_global_loading(false) as useEffect handles this.
    },
  });

  // Effect to synchronize React Query's loading state with the global loading indicator
  React.useEffect(() => {
    set_global_loading(query_is_loading);
  }, [query_is_loading, set_global_loading]); // Dependencies: reruns when loading state changes

  // Determine the list of projects to display. We primarily use the `my_projects` array from the global store,
  // which is kept in sync by the `onSuccess` callback of the `useQuery` hook.
  const projects_to_display = my_projects; // Use my_projects from global store

  /**
   * Handles the click event on a project card. Navigates to the project's Kanban board.
   * @param project_key The unique key of the project to navigate to.
   */
  const handle_project_card_click = (project_key: string) => {
    navigate(`/projects/${project_key}/board`);
  };

  return (
    <>
      {/* Main container for the dashboard view */}
      <div className="p-6 bg-gray-100 min-h-[calc(100vh-64px)]"> {/* Adjust min-height based on GV_TopNavigation height */}
        {/* Header section with "My Projects" title and "Create Project" button */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">My Projects</h1>
          <Link
            to="/projects/create"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Create Project
          </Link>
        </div>

        {/* Conditional Rendering for Loading State */}
        {query_is_loading && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <svg className="animate-spin h-12 w-12 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-lg font-medium">Loading projects...</p>
          </div>
        )}

        {/* Conditional Rendering for Error State */}
        {query_is_error && (
          <div className="flex flex-col items-center justify-center py-16 text-red-600 bg-red-50 border border-red-200 rounded-lg p-8 shadow-sm">
            <svg className="h-12 w-12 mb-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p className="text-xl font-semibold mb-3">Failed to Load Projects</p>
            <p className="text-md text-gray-700 text-center mb-6">{query_error?.message || 'An unexpected error occurred.'}</p>
            <button
              onClick={() => refetch()} // Allows user to retry fetching data
              className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {/* Conditional Rendering for "No Projects Yet" */}
        {!query_is_loading && !query_is_error && projects_to_display.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-700 bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
            <svg className="h-16 w-16 text-gray-400 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <p className="text-2xl font-semibold mb-4">No Projects Yet</p>
            <p className="text-lg text-center leading-relaxed max-w-xl mb-8">
              It looks like you haven't created or been added to any projects.
              Start by creating one and invite your team!
            </p>
            <Link
              to="/projects/create"
              className="mt-4 px-8 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Start Your First Project
            </Link>
          </div>
        )}

        {/* Display Projects List as Cards */}
        {!query_is_loading && !query_is_error && projects_to_display.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {projects_to_display.map((project) => (
              <div
                key={project.id}
                className="bg-white rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 ease-in-out
                           overflow-hidden flex flex-col cursor-pointer border border-gray-200"
                onClick={() => handle_project_card_click(project.project_key)}
              >
                <div className="p-6 flex-grow">
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="text-xl font-bold text-gray-900 leading-tight pr-4">
                      {project.project_name} <span className="text-sm font-normal text-gray-500 ml-1">({project.project_key})</span>
                    </h2>
                    <span
                      className={`px-3 py-1 text-xs font-semibold rounded-full
                                  ${project.user_role === 'Admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}
                    >
                      {project.user_role}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                    {project.description || 'No description provided for this project.'}
                  </p>
                </div>
                <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 flex items-center justify-between text-sm text-gray-700">
                  <div className="flex items-center">
                    {render_user_avatar(project.project_lead)}
                    <span className="font-medium text-gray-800">
                      {project.project_lead.first_name} {project.project_lead.last_name}
                    </span>
                  </div>
                  <span className="text-gray-500">
                    Created: {new Date(project.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default UV_MyProjectsDashboard;