import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/main';
import { MagnifyingGlassIcon, BellIcon, ChevronDownIcon, UserCircleIcon, XMarkIcon } from '@heroicons/react/24/solid';

// Move GV_GlobalNotificationsPanel outside GV_TopNavigation
// so it's not redefined on every render of GV_TopNavigation.
const GV_GlobalNotificationsPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    // Consistent Redux access via hook
    const { global_notifications, mark_notification_as_read, mark_all_notifications_as_read } = useAppStore();
    const navigate = useNavigate(); // Add useNavigate hook for internal navigation

    if (!isOpen) return null;

    // The component would typically use a portal to render outside the main DOM flow
    // For now, it's a simple conditionally rendered div within the top navigation.
    return (
        <div className="absolute right-0 top-16 mt-2 w-80 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
            <div className="px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                <span className="text-lg font-semibold text-gray-900">Notifications</span>
                <button
                    onClick={onClose} // onClose will now directly set isOpen to false in parent
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    aria-label="Close notifications"
                >
                    <XMarkIcon className="h-5 w-5" /> {/* Using XMarkIcon for 'X' */}
                </button>
            </div>
            {global_notifications.notifications.length === 0 ? (
                <div className="py-4 px-4 text-center text-gray-500">No new notifications.</div>
            ) : (
                <div className="max-h-80 overflow-y-auto">
                    {global_notifications.notifications.map((notif) => (
                        <div
                            key={notif.id}
                            className={`block px-4 py-3 text-sm border-b border-gray-100 ${notif.is_read ? 'text-gray-500' : 'text-gray-900 font-medium bg-blue-50'} cursor-pointer`} // Added cursor-pointer for better UX
                            onClick={() => {
                                if (!notif.is_read) {
                                    mark_notification_as_read(notif.id);
                                }
                                // Navigate to issue details as per DATAMAP and SITEMAP
                                if (notif.issue_key) { // Ensure issue_key exists before navigating
                                    navigate(`/issues/${notif.issue_key}`);
                                } else {
                                    // Log or handle case where issue_key might be missing
                                    console.warn(`Notification ID ${notif.id} has no issue_key, cannot navigate.`);
                                }
                                onClose();
                            }}
                        >
                            <p className="line-clamp-2">{notif.summary_text}</p>
                            <p className="text-xs text-gray-400 mt-1">{new Date(notif.created_at).toLocaleString()}</p>
                        </div>
                    ))}
                </div>
            )}
            <div className="px-4 py-2 border-t border-gray-200">
                <button
                    onClick={mark_all_notifications_as_read} // Consistent access
                    className="w-full text-blue-600 hover:underline text-sm focus:outline-none"
                >
                    Mark All as Read
                </button>
            </div>
        </div>
    );
};


interface GV_TopNavigationProps {}

const GV_TopNavigation: React.FC<GV_TopNavigationProps> = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // Global state access
    const { authenticated_user, logout: global_logout_action, global_notifications } = useAppStore();
    const is_authenticated = !!authenticated_user;

    // Local component state
    const [global_search_query_input, set_global_search_query_input] = useState<string>('');
    const [is_user_profile_dropdown_open, set_is_user_profile_dropdown_open] = useState<boolean>(false);
    const [is_notification_panel_open, set_is_notification_panel_open] = useState<boolean>(false);

    // Refs for click-outside logic
    const profileDropdownRef = useRef<HTMLDivElement>(null);
    const notificationPanelRef = useRef<HTMLDivElement>(null);

    // Actions
    const handle_search_input_change = (e: React.ChangeEvent<HTMLInputElement>) => {
        set_global_search_query_input(e.target.value);
    };

    const submit_global_search = (e?: React.FormEvent) => {
        e?.preventDefault(); // Prevent default form submission if triggered by form
        if (global_search_query_input.trim()) {
            navigate(`/search?query=${encodeURIComponent(global_search_query_input.trim())}`);
            set_global_search_query_input(''); // Clear search input after submission
        }
    };

    // Corrected `close_notification_panel` to explicitly close
    const close_notification_panel = useCallback(() => {
        set_is_notification_panel_open(false);
    }, []);

    const toggle_notification_panel = useCallback(() => {
        set_is_notification_panel_open((prev) => !prev);
        set_is_user_profile_dropdown_open(false); // Close other dropdown
    }, []); // Dependencies are stable setters, so empty array is fine here.

    const toggle_user_profile_dropdown = useCallback(() => {
        set_is_user_profile_dropdown_open((prev) => !prev);
        set_is_notification_panel_open(false); // Close other panel
    }, []); // Dependencies are stable setters, so empty array is fine here.

    const closeAll = useCallback(() => {
        set_is_user_profile_dropdown_open(false);
        set_is_notification_panel_open(false);
    }, []); // Dependencies are stable setters, so empty array is fine here.

    const navigate_to_my_profile = useCallback(() => {
        navigate('/profile');
        closeAll();
    }, [navigate, closeAll]); // 'navigate' is stable, 'closeAll' is stable, so dependencies are correct.

    const logout = useCallback(() => {
        global_logout_action();
        navigate('/login');
        closeAll();
    }, [global_logout_action, navigate, closeAll]); // Dependencies are stable, so correct.

    const navigate_to_home = useCallback(() => {
        if (is_authenticated) {
            navigate('/dashboard');
        } else {
            navigate('/login');
        }
        closeAll();
    }, [is_authenticated, navigate, closeAll]); // Added is_authenticated to dependencies.

    // Effect for click outside logic
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // Check if click is outside both dropdowns/panels
            // Use separate checks for independent control
            if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
                set_is_user_profile_dropdown_open(false);
            }
            if (notificationPanelRef.current && !notificationPanelRef.current.contains(event.target as Node)) {
                set_is_notification_panel_open(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []); // No dependencies needed as refs and setters are stable

    // Also close dropdowns if navigation occurs
    useEffect(() => {
        closeAll();
    }, [location.pathname, closeAll]); // `closeAll` is stable, `location.pathname` is fine.

    // Determine default avatar initials
    const user_initials = authenticated_user
        ? `${authenticated_user.first_name?.[0] || ''}${authenticated_user.last_name?.[0] || ''}`.toUpperCase()
        : '';
    const user_full_name = authenticated_user ? `${authenticated_user.first_name} ${authenticated_user.last_name}` : '';

    return (
        <>
            <nav className="fixed top-0 left-0 w-full bg-white shadow-md z-40 p-4">
                <div className="container mx-auto flex justify-between items-center">
                    {/* AetherFlow Logo/Name (Branding and Home Link) */}
                    <Link
                        to={is_authenticated ? '/dashboard' : '/login'}
                        className="text-2xl font-bold text-blue-600 hover:text-blue-800 transition-colors"
                        onClick={navigate_to_home}
                    >
                        AetherFlow
                    </Link>

                    {is_authenticated ? (
                        <>
                            {/* Global Search Bar (Authenticated Only) */}
                            <div className="flex-1 max-w-lg mx-4 relative">
                                <form onSubmit={submit_global_search} className="flex items-center w-full">
                                    <input
                                        type="text"
                                        placeholder="Search issues by KEY or Summary..."
                                        className="pl-10 pr-4 py-2 w-full rounded-full border border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-gray-900 placeholder-gray-500 text-sm"
                                        value={global_search_query_input}
                                        onChange={handle_search_input_change}
                                        aria-label="Global search for issues"
                                    />
                                    <button
                                        type="submit"
                                        className="absolute left-3 text-gray-400 hover:text-blue-500 focus:outline-none"
                                        aria-label="Submit search"
                                    >
                                        <MagnifyingGlassIcon className="h-5 w-5" />
                                    </button>
                                </form>
                            </div>

                            {/* Right Side - User Actions (Authenticated Only) */}
                            <div className="flex items-center space-x-4">
                                {/* Notification Bell */}
                                <div className="relative" ref={notificationPanelRef}>
                                    <button
                                        type="button"
                                        onClick={toggle_notification_panel}
                                        className="relative p-2 rounded-full text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                        aria-label="Notifications"
                                    >
                                        <BellIcon className="h-6 w-6" />
                                        {global_notifications.unread_count > 0 && (
                                            <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-semibold leading-none text-red-100 bg-red-600 rounded-full transform translate-x-1/2 -translate-y-1/2">
                                                {global_notifications.unread_count}
                                            </span>
                                        )}
                                    </button>
                                    <GV_GlobalNotificationsPanel 
                                        isOpen={is_notification_panel_open} 
                                        onClose={close_notification_panel}
                                    />
                                </div>

                                {/* User Profile Dropdown */}
                                <div className="relative" ref={profileDropdownRef}>
                                    <button
                                        type="button"
                                        onClick={toggle_user_profile_dropdown}
                                        className="flex items-center space-x-2 text-gray-700 hover:bg-gray-100 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                        aria-label="User profile menu"
                                    >
                                        {authenticated_user?.profile_picture_url ? (
                                            <img
                                                className="h-8 w-8 rounded-full object-cover"
                                                src={authenticated_user.profile_picture_url}
                                                alt={`${user_full_name} profile picture`}
                                            />
                                        ) : (
                                            <div className="h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-semibold">
                                                {user_initials || <UserCircleIcon className="h-full w-full text-blue-200" />}
                                            </div>
                                        )}
                                        <span className="hidden md:block text-sm font-medium">{authenticated_user?.first_name}</span>
                                        <ChevronDownIcon className={`h-4 w-4 transition-transform ${is_user_profile_dropdown_open ? 'rotate-180' : ''}`} />
                                    </button>

                                    {is_user_profile_dropdown_open && (
                                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                                            <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200 font-medium">
                                                {user_full_name}
                                            </div>
                                            <Link
                                                to="/profile"
                                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                                onClick={navigate_to_my_profile}
                                            >
                                                My Profile
                                            </Link>
                                            <button
                                                onClick={logout}
                                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 border-t border-gray-200"
                                            >
                                                Logout
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        // Optional: Login/Sign Up buttons for unauthenticated state, as mentioned in PRD "optionally"
                        // I'm opting to just show the logo and let the routing handle login/register directly.
                        null
                    )}
                </div>
            </nav>
            {/* This div compensates for the fixed nav bar, pushing content below it */}
            <div className="pt-16"></div> 
        </>
    );
};

export default GV_TopNavigation;