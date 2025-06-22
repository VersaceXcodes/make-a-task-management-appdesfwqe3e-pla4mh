import React, { useState, useEffect, FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAppStore } from '@/store/main'; // Importing the global store

// Define interfaces for API response types as per OpenAPI spec
interface IssueSearchResponseItem {
  id: string;
  issue_key: string;
  summary: string;
  project_id: string;
  project_name: string;
  project_key: string;
}

// Data fetching function for React Query
const fetch_global_search_results = async (query_string: string, auth_token: string | null): Promise<IssueSearchResponseItem[]> => {
  if (!query_string.trim()) {
    return []; // Return empty array if query is empty to avoid unnecessary API calls
  }

  const headers = auth_token ? { Authorization: `Bearer ${auth_token}` } : {};

  try {
    const { data } = await axios.get<IssueSearchResponseItem[]>(
      `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}/api/v1/search/issues`,
      {
        params: { query: query_string },
        headers: headers,
      }
    );
    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('Error fetching global search results:', err.response?.data || err.message);
      throw new Error(err.response?.data?.message || 'Failed to fetch search results.');
    }
    throw new Error('An unexpected error occurred during search.');
  }
};

const UV_GlobalSearchResults: React.FC = () => {
  const [search_params, set_search_params] = useSearchParams();
  const navigate = useNavigate();
  const set_global_loading = useAppStore((state) => state.set_global_loading);
  const auth_token = useAppStore((state) => state.auth_token);

  const current_url_query = search_params.get('query') || '';

  const [temp_input_query, set_temp_input_query] = useState<string>(current_url_query);

  useEffect(() => {
    if (current_url_query !== temp_input_query) {
      set_temp_input_query(current_url_query);
    }
  }, [current_url_query, temp_input_query]);

  // React Query hook for fetching search results
  const {
    data: search_results,
    isLoading: is_loading_query,
    isError: is_error_query,
    error: query_error,
  } = useQuery<IssueSearchResponseItem[], Error>({
    queryKey: ['global_search_issues', current_url_query, auth_token], // Query key depends on the input value
    queryFn: () => fetch_global_search_results(current_url_query, auth_token),
    enabled: !!current_url_query && !!auth_token, // Only fetch if current_search_query_input is not empty
    staleTime: 1000 * 60, // Data considered fresh for 1 minute
    placeholderData: [], // Show empty array while loading or if query is empty initially
  });

  // Update global loading indicator based on query loading state
  useEffect(() => {
    set_global_loading(is_loading_query);
  }, [is_loading_query, set_global_loading]);

  // Action: Updates the `current_search_query_input` state variable as the user types
  const update_search_query_input = (event: React.ChangeEvent<HTMLInputElement>) => {
    set_temp_input_query(event.target.value);
  };

  // Action: Executes the global issue search
  const perform_search = (event?: FormEvent) => {
    event?.preventDefault(); // Prevent default form submission behavior

    // Update URL's search param, which will then trigger the useEffect and subsequently the useQuery
    set_search_params({ query: temp_input_query });
    // Also explicitly refetch in case the query input value didn't change but the user pressed enter
    // (e.g., after initial load, user presses enter without typing more)
  };

  // Action: Navigates the user to the detailed view of the selected issue.
  const handle_search_result_click = (issue_key: string) => {
    navigate(`/issues/${issue_key}`);
  };

  return (
    <>
      <div className="container mx-auto p-4 sm:p-6 lg:p-8 bg-white shadow-lg rounded-lg">
        {/* Title and Search Input */}
        <h1 className="text-3xl font-extrabold text-gray-900 mb-6 border-b pb-4">
          {current_url_query ? `Global Search Results for: \"${current_url_query}\"` : "Global Search"}
        </h1>

        <form onSubmit={perform_search} className="mb-8 flex items-center space-x-4">
          <input
            type="text"
            className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-lg"
            placeholder="Search issues by key or summary..."
            value={temp_input_query}
            onChange={update_search_query_input}
          />
          <button
            type="submit"
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-150 ease-in-out"
          >
            Search
          </button>
        </form>

        {/* Loading State */}
        {is_loading_query && (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <p className="ml-4 text-gray-600 text-lg">Searching...</p>
          </div>
        )}

        {/* Error State */}
        {is_error_query && (
          <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-md" role="alert">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline ml-2">{query_error?.message || 'Failed to fetch search results.'}</span>
          </div>
        )}

        {/* No Results Found */}
        {!is_loading_query && !is_error_query && search_results?.length === 0 && (
          <div className="p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded-md">
            <strong className="font-bold">No Results Found.</strong>
            <span className="block sm:inline ml-2">Your search "{current_url_query}" did not match any issues.</span>
          </div>
        )}

        {/* Search Results Table */}
        {!is_loading_query && !is_error_query && search_results && search_results.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issue Key
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Summary
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Project Name
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {search_results.map((issue) => (
                  <tr
                    key={issue.id}
                    className="hover:bg-gray-100 cursor-pointer transition duration-150 ease-in-out"
                    onClick={() => handle_search_result_click(issue.issue_key)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-blue-600 hover:text-blue-800 font-medium">
                        {issue.issue_key}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-normal break-words max-w-lg">
                      <span className="text-gray-900">{issue.summary}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-gray-900">{issue.project_name} ({issue.project_key})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default UV_GlobalSearchResults;