import React, { Suspense, lazy } from 'react';
import { Route, Routes, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '@/store/main';

// Import Global Views
import GV_TopNavigation from '@/components/views/GV_TopNavigation.tsx';
import GV_LeftSidebar from '@/components/views/GV_LeftSidebar.tsx';
import GV_ProjectSubNavigation from '@/components/views/GV_ProjectSubNavigation.tsx';
// Assuming GV_GlobalNotificationsPanel is managed by GV_TopNavigation or a portal outside App.tsx logic
import GV_GlobalConfirmationModal from '@/components/views/GV_GlobalConfirmationModal.tsx';
import GV_GlobalSnackBarNotifications from '@/components/views/GV_GlobalSnackBarNotifications.tsx';

// Import Unique Views
import UV_Login from '@/components/views/UV_Login.tsx';
import UV_Register from '@/components/views/UV_Register.tsx';
import UV_ForgotPasswordRequest from '@/components/views/UV_ForgotPasswordRequest.tsx';
import UV_ResetPassword from '@/components/views/UV_ResetPassword.tsx';
import UV_EmailVerificationSuccess from '@/components/views/UV_EmailVerificationSuccess.tsx';
import UV_EmailVerificationFailed from '@/components/views/UV_EmailVerificationFailed.tsx';
import UV_MyProjectsDashboard from '@/components/views/UV_MyProjectsDashboard.tsx';
import UV_UserProfile from '@/components/views/UV_UserProfile.tsx';
import UV_MyWorkDashboard from '@/components/views/UV_MyWorkDashboard.tsx';
import UV_GlobalSearchResults from '@/components/views/UV_GlobalSearchResults.tsx';
import UV_ProjectCreation from '@/components/views/UV_ProjectCreation.tsx';
import UV_ProjectBoard from '@/components/views/UV_ProjectBoard.tsx';
import UV_ProjectIssuesList from '@/components/views/UV_ProjectIssuesList.tsx';
import UV_ProjectSettingsDetails from '@/components/views/UV_ProjectSettingsDetails.tsx';
import UV_ProjectSettingsMembers from '@/components/views/UV_ProjectSettingsMembers.tsx';
import UV_IssueCreation from '@/components/views/UV_IssueCreation.tsx';
import UV_IssueDetails from '@/components/views/UV_IssueDetails.tsx';

// Initialize React Query client
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // Data considered stale after 5 minutes
            refetchOnWindowFocus: false, // Prevents automatic refetching on window focus
            retry: 1, // Retries failed queries once
        },
    },
});

/**
 * A generic Error Boundary component to prevent app crashes.
 * Displays a fallback UI when a component within its tree throws an error.
 */
class ErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
    constructor(props: React.PropsWithChildren) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(_: Error) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // You can also log the error to an error reporting service
        console.error("Uncaught error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            // You can render any custom fallback UI
            return (
                <div className="flex flex-col items-center justify-center min-h-screen text-gray-700">
                    <h1 className="text-4xl font-bold mb-4">Oops! Something went wrong.</h1>
                    <p className="text-lg mb-8">We're sorry for the inconvenience. Please try again later.</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
                    >
                        Reload Page
                    </button>
                    {/* Optionally, you might provide a way to go back to a safe route like /dashboard */}
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * A wrapper component for routes that require authentication.
 * If the user is not authenticated, it redirects them to the login page.
 */
const ProtectedRoute: React.FC = () => {
    const { authenticated_user } = useAppStore();
    // Assuming authenticated_user is synchronously available or null when not authenticated
    // If it's undefined during initial loading, you might need a loading state here.
    if (authenticated_user === undefined) { // Or if loading, show a spinner
        return <div>Loading authentication...</div>; // Or return null/a loading spinner appropriately
    }
    return authenticated_user ? <Outlet /> : <Navigate to="/login" replace />;
};

/**
 * A layout component for authenticated routes, including the GV_LeftSidebar.
 */
const AuthenticatedLayout: React.FC = () => {
    const { authenticated_user } = useAppStore();
    const location = useLocation();

    // Determine if the current route path is one of the "auth forms" that should not show the sidebar
    const isAuthFormRoute = [
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        '/verify-email/success',
        '/verify-email/fail',
    ].some(path => location.pathname.startsWith(path));

    return (
        <div className="flex flex-1 overflow-hidden">
            {/* GV_LeftSidebar is only rendered for authenticated users and not on auth-related forms */}
            {authenticated_user && !isAuthFormRoute && <GV_LeftSidebar />}
            {/* Main content area with padding and scroll. Removed direct padding from ProjectLayout to prevent double padding. */}
            <main className="flex-1 overflow-auto p-4">
                <Outlet /> {/* Renders the matched child route component */}
            </main>
        </div>
    );
};

/**
 * A layout component specifically for project-related routes, including GV_ProjectSubNavigation.
 * This layout should be nested within AuthenticatedLayout.
 */
const ProjectLayout: React.FC = () => {
    const { authenticated_user } = useAppStore();
    const { project_key } = useParams<{ project_key?: string }>(); // Extract project_key from URL params

    // GV_ProjectSubNavigation is only shown if authenticated and a project_key is present
    const showProjectSubNav = authenticated_user && project_key;

    return (
        <div className="flex flex-col flex-1">
            {/* Pass the extracted project_key to the sub-navigation component */}
            {showProjectSubNav && <GV_ProjectSubNavigation projectKey={project_key || ''} />}
            {/* Content area for project-specific views. Padding is provided by AuthenticatedLayout. */}
            <div className="flex-1 overflow-auto">
                <Outlet />
            </div>
        </div>
    );
};

/**
 * Handles initial redirection based on authentication status.
 * Prevents redundant re-evaluations at root.
 */
const RedirectToLoginOrDashboard: React.FC = () => {
    const { authenticated_user } = useAppStore();

    // If authentication status is still being determined (e.g., during hydration), show loading
    if (authenticated_user === undefined) { // Assuming useAppStore sets this to null/undefined if not authenticated/loading.
        return <div>Loading application...</div>; // Or a more sophisticated loading spinner/screen
    }

    return authenticated_user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />;
};

const App: React.FC = () => {
    return (
        <QueryClientProvider client={queryClient}>
            <div className="font-sans antialiased text-gray-900 bg-gray-100 min-h-screen flex flex-col">
                {/* Global Top Navigation (always visible) */}
                <GV_TopNavigation />

                {/* Wrap Routes with ErrorBoundary for robust error handling */}
                <ErrorBoundary>
                    {/* Wrap Routes with Suspense for lazy loading fallbacks */}
                    <Suspense fallback={
                        <div className="flex flex-1 items-center justify-center min-h-[calc(100vh-64px)]">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
                            <span className="ml-4 text-lg text-gray-600">Loading content...</span>
                        </div>
                    }>
                        <Routes>
                            {/* Root path redirection: uses a dedicated component for clearer logic */}
                            <Route path="/" element={<RedirectToLoginOrDashboard />} />

                            {/* Unauthenticated / Public Routes (no sidebar) */}
                            <Route path="/login" element={<UV_Login />} />
                            <Route path="/register" element={<UV_Register />} />
                            <Route path="/forgot-password" element={<UV_ForgotPasswordRequest />} />
                            <Route path="/reset-password" element={<UV_ResetPassword />} />
                            <Route path="/verify-email/success" element={<UV_EmailVerificationSuccess />} />
                            <Route path="/verify-email/fail" element={<UV_EmailVerificationFailed />} />

                            {/* Protected Routes (require authentication) */}
                            <Route element={<ProtectedRoute />}>
                                {/* Routes that use the AuthenticatedLayout (with Left Sidebar) */}
                                <Route element={<AuthenticatedLayout />}>
                                    {/* General Authenticated Dashboard & Profile Views */}
                                    <Route path="/dashboard" element={<UV_MyProjectsDashboard />} />
                                    <Route path="/profile" element={<UV_UserProfile />} />
                                    <Route path="/my-work" element={<UV_MyWorkDashboard />} />
                                    <Route path="/search" element={<UV_GlobalSearchResults />} />
                                    <Route path="/projects/create" element={<UV_ProjectCreation />} />
                                    <Route path="/issues/create" element={<UV_IssueCreation />} /> {/* Moved to be outside project-specific path due to its general nature */}
                                    
                                    {/* Corrected placement for Issue Details: It's typically globally addressable by issue_key */}
                                    <Route path="/issues/:issue_key" element={<UV_IssueDetails />} />

                                    {/* Project-Specific Routes (nested within AuthenticatedLayout; use ProjectLayout for project sub-navigation) */}
                                    <Route element={<ProjectLayout />}>
                                        {/* Project Board, Issues List, Settings, and Issue Details */}
                                        <Route path="/projects/:project_key/board" element={<UV_ProjectBoard />} />
                                        <Route path="/projects/:project_key/issues" element={<UV_ProjectIssuesList />} />
                                        <Route path="/projects/:project_key/settings/details" element={<UV_ProjectSettingsDetails />} />
                                        <Route path="/projects/:project_key/settings/members" element={<UV_ProjectSettingsMembers />} />
                                    </Route>
                                </Route>
                            </Route>

                            {/* Catch-all route for 404 (Not Found) pages. Redirect to dashboard if logged in, else login. */}
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                        </Routes>
                    </Suspense>
                </ErrorBoundary>

                {/* Global Overlays (float above all content and are controlled by global state) */}
                <GV_GlobalConfirmationModal />
                <GV_GlobalSnackBarNotifications />
            </div>
        </QueryClientProvider>
    );
};

export default App;