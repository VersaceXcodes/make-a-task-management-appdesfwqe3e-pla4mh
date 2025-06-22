import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAppStore, ProjectListResponse } from '@/store/main';

// Define the props for the GV_ProjectSubNavigation component
interface GV_ProjectSubNavigationProps {
  projectKey: string; // The unique project key from the URL slug
}

// Define the interface for the derived project metadata, for clarity and type safety
interface ProjectMetadata {
  id: string;
  project_name: string;
  project_key: string;
  user_role: "Admin" | "Member";
}

const GV_ProjectSubNavigation: React.FC<GV_ProjectSubNavigationProps> = ({ projectKey }) => {
  // Access the my_projects array from the global Zustand store
  const my_projects = useAppStore((state) => state.my_projects);

  // Derive the current_project_metadata based on the projectKey prop
  // useMemo ensures this derivation only re-runs if projectKey or my_projects changes
  const current_project_metadata: ProjectListResponse | undefined = useMemo(() => {
    return my_projects.find((project: ProjectListResponse) => project.project_key === projectKey);
  }, [projectKey, my_projects]);

  // If project metadata is not found, render nothing or a placeholder.
  // In a real application, robust error handling or redirection might be needed here.
  if (!current_project_metadata) {
    return null; // Or a loading spinner, or an error message: <div>Loading project data...</div>
  }

  // Determine if the current user is an Admin for this project to conditionally show the settings link
  const is_project_admin = current_project_metadata.user_role === 'Admin';

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between">
      {/* Project Name Display */}
      <div className="flex items-center space-x-3">
        <h2 className="font-semibold text-lg text-gray-800">
          {current_project_metadata.project_name}
        </h2>
        <span className="text-sm text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full">
          {current_project_metadata.project_key}
        </span>
      </div>

      {/* Navigation Links */}
      <nav className="flex space-x-4">
        <NavLink
          to={`/projects/${projectKey}/board`}
          className={({ isActive }) =>
            `text-gray-600 hover:text-blue-700 px-3 py-2 rounded-md transition-colors duration-200 ease-in-out ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : ''}`
          }
        >
          Board
        </NavLink>
        <NavLink
          to={`/projects/${projectKey}/issues`}
          className={({ isActive }) =>
            `text-gray-600 hover:text-blue-700 px-3 py-2 rounded-md transition-colors duration-200 ease-in-out ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : ''}`
          }
        >
          Issues
        </NavLink>
        {is_project_admin && (
          <NavLink
            to={`/projects/${projectKey}/settings/details`}
            className={({ isActive }) =>
              `text-gray-600 hover:text-blue-700 px-3 py-2 rounded-md transition-colors duration-200 ease-in-out ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : ''}`
            }
          >
            Project Settings
          </NavLink>
        )}
      </nav>
    </div>
  );
};

export default GV_ProjectSubNavigation;