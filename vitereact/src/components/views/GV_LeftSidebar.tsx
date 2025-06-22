// GV_LeftSidebar.tsx
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppStore } from '@/store/main';
import {
  FolderIcon,
  Cog6ToothIcon,
  PlusIcon,
  ChevronDoubleLeftIcon, // Icon for collapsing the sidebar
  ChevronDoubleRightIcon, // Icon for expanding the sidebar
  InboxStackIcon, // Icon for My Work
  ChevronDownIcon, // Icon for expanding the projects list
  ChevronUpIcon, // Icon for collapsing the projects list
} from '@heroicons/react/24/outline'; // Importing outline icons from Heroicons

// Define props interface (none explicitly required according to datamap, but good practice)
interface GV_LeftSidebarProps {}

const GV_LeftSidebar: React.FC<GV_LeftSidebarProps> = () => {
  const navigate = useNavigate();
  // Access global state for authentication status and user's projects
  const { authenticated_user, my_projects } = useAppStore((state) => ({
    authenticated_user: state.authenticated_user,
    my_projects: state.my_projects
  }));

  // Internal component state for sidebar collapse and projects list expansion
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isProjectsListExpanded, setIsProjectsListExpanded] = useState(true);

  // If the user is not authenticated, this component should not render.
  // This ensures the sidebar is only visible to logged-in users.
  if (!authenticated_user) {
    return null;
  }

  // Action: Toggles the `isCollapsed` state to expand or collapse the sidebar.
  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => !prev);
  };

  // Action: Toggles the `isProjectsListExpanded` state for the projects list.
  const handleToggleProjectsList = () => {
    setIsProjectsListExpanded((prev) => !prev);
  };

  // Action: Redirects the user to their main dashboard displaying all projects.
  // This is a direct navigation action for the 'Projects' header link.
  const handleNavigateToMyProjects = () => {
    navigate('/dashboard');
  };

  return (
    <>
      {/* Main sidebar container. Dynamically changes width based on `is_collapsed` state. */}
      {/* Uses fixed positioning to keep it on the left side of the viewport. */}
      <div
        className={`fixed left-0 top-0 z-40 flex h-screen flex-col bg-gray-800 py-4 transition-all duration-300 ease-in-out
          ${isCollapsed ? 'w-20' : 'w-64'} py-4 flex flex-col z-40`}
      >
        {/* Sidebar Collapse/Expand Toggle Button */}
        {/* Positioned at the top-right of the sidebar */}
        <div className="flex justify-end p-2 pr-4">
          <button
            type="button"
            onClick={handleToggleCollapse}
            className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <ChevronDoubleRightIcon className="h-6 w-6 text-gray-400 hover:text-white" />
            ) : (
              <ChevronDoubleLeftIcon className="h-6 w-6 text-gray-400 hover:text-white" />
            )}
          </button>
        </div>

        {/* Navigation links section (scrollable if content overflows) */}
        <nav className="custom-scrollbar flex-1 space-y-2 overflow-y-auto px-2"> {/* `custom-scrollbar` can be defined in global CSS */}
          {/* "My Work" / "Assigned to Me" Link */}
          <Link
            to="/my-work"
            className={`flex items-center rounded-md p-2 hover:bg-gray-700 
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800
                        ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? "My Work" : ""} // Tooltip when collapsed
          >
            <InboxStackIcon className="h-6 w-6" />
            {!isCollapsed && <span className="ml-3 text-sm font-medium whitespace-nowrap">My Work</span>}
          </Link>

          {/* Projects Section - Header & List */}
          <div className="border-t border-gray-700 pt-4">
            {/* Projects Section Header: now separate elements for navigation and toggle */}
            <div
              className={`flex items-center rounded-md p-2 ${isCollapsed ? 'justify-center' : 'justify-between'}`}
            >
              {/* Projects text (for navigation to /dashboard) */}
              <Link
                to="/dashboard"
                onClick={handleNavigateToMyProjects}
                className="-m-2 flex flex-grow items-center rounded-md p-2 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                aria-label={isCollapsed ? 'Projects' : undefined}
                title={isCollapsed ? 'Projects' : undefined}
              >
                <FolderIcon className="h-6 w-6" />
                {!isCollapsed && <span className="ml-3 whitespace-nowrap text-sm font-medium">Projects</span>}
              </Link>

              {/* Expand/Collapse icon for the projects list (for toggling) */}
              {!isCollapsed && (
                <button
                  type="button"
                  onClick={handleToggleProjectsList}
                  className="ml-2 rounded-md p-1 focus:outline-none hover:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                  aria-label={isProjectsListExpanded ? 'Collapse projects list' : 'Expand projects list'}
                >
                  {isProjectsListExpanded ? (
                    <ChevronUpIcon className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              )}
            </div>

            {/* List of projects (only visible when expanded and sidebar is not collapsed) */}
            {isProjectsListExpanded && !isCollapsed && (
              <ul className="mt-2 space-y-1 pl-4">
                {my_projects.length > 0 ? (
                  my_projects.map((project) => (
                    <li key={project.id}>
                      {/* Button to navigate to a specific project's board */}
                      <Link
                        to={`/projects/${project.project_key}/board`}
                        className="block w-full truncate rounded-md p-2 text-left text-sm text-gray-300 hover:bg-gray-700 
                                   focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                        title={project.project_name} // Full project name as tooltip for truncated text
                      >
                        {project.project_name}
                      </Link>
                    </li>
                  ))
                ) : (
                  <li className="p-2 text-xs text-gray-400">No projects yet.</li>
                )}
              </ul>
            )}

            {/* "Create Project" Link */}
            <Link
              to="/projects/create"
              className={`mt-2 flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700
                ${isCollapsed ? 'h-10 w-10 p-0 text-lg' : 'w-full px-4'}`}
              title="Create Project"
            >
              <PlusIcon className="h-5 w-5" />
              {!isCollapsed && <span className="ml-2 whitespace-nowrap">Create Project</span>}
            </Link>
          </div>
        </nav>

        {/* "Settings" Link (fixed at the bottom of the sidebar) */}
        <div className="mt-auto border-t border-gray-700 px-2 pb-2 pt-4">
          <Link
            to="/profile"
            className={`flex items-center rounded-md p-2 hover:bg-gray-700 
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800
                        ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? "Settings" : ""} // Tooltip when collapsed
          >
            <Cog6ToothIcon className="h-6 w-6" />
            {!isCollapsed && <span className="ml-3 text-sm font-medium whitespace-nowrap">Settings</span>}
          </Link>
        </div>
      </div>

      {/* A spacer div, ensures main content starts after sidebar */}
      <div className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-64'}`}></div>
    </>
  );
};

export default GV_LeftSidebar;