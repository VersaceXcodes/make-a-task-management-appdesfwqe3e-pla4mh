import React, { useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppStore } from '@/store/main'; // Importing from global store
import { NotificationSummary } from '@/store/main'; // Import NotificationSummary type

// Define component props
interface GV_GlobalNotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Helper function to format time ago (declared outside to avoid re-creation)
const formatTimeAgo = (isoString: string): string => {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  let interval = seconds / 31536000;
  if (interval > 1) {
    return `${Math.floor(interval)} ${Math.floor(interval) === 1 ? 'year' : 'years'} ago`;
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return `${Math.floor(interval)} ${Math.floor(interval) === 1 ? 'month' : 'months'} ago`;
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return `${Math.floor(interval)} ${Math.floor(interval) === 1 ? 'day' : 'days'} ago`;
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return `${Math.floor(interval)} ${Math.floor(interval) === 1 ? 'hour' : 'hours'} ago`;
  }
  interval = seconds / 60;
  if (interval > 1) {
    return `${Math.floor(interval)} ${Math.floor(interval) === 1 ? 'minute' : 'minutes'} ago`;
  }
  return `${Math.floor(seconds)} ${Math.floor(seconds) === 1 ? 'second' : 'seconds'} ago`;
};

const GV_GlobalNotificationsPanel: React.FC<GV_GlobalNotificationsPanelProps> = ({ isOpen, onClose }) => {
  // Access global state and actions from Zustand store
  const {
    global_notifications,
    mark_all_notifications_as_read,
    mark_notification_as_read,
    authenticated_user,
    fetch_global_notifications // Used for initial fetch on open
  } = useAppStore();

  const navigate = useNavigate(); // Hook for programmatic navigation
  const panelRef = useRef<HTMLDivElement>(null); // Ref for click-outside detection

  // Effect for handling clicks outside the notification panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If the panel is open and the click is outside the panel, close it
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    // Cleanup function: remove event listener when component unmounts or isOpen changes
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]); // Dependencies: re-run effect if isOpen or onClose changes

  // Effect for fetching notifications when the panel opens
  // ISSUE-001 FIX: Always fetch when opened to ensure up-to-date data.
  useEffect(() => {
    if (isOpen && authenticated_user) {
      fetch_global_notifications();
    }
  }, [isOpen, authenticated_user, fetch_global_notifications]);

  // If the panel is not open, render nothing
  if (!isOpen) {
    return null;
  }

  const notificationsToDisplay = global_notifications.notifications;
  const hasUnread = global_notifications.unread_count > 0;

  // ISSUE-002 FIX: Use useCallback for event handlers for performance/stability.
  const handleMarkAllAsRead = useCallback(async () => {
    await mark_all_notifications_as_read();
    // Optionally re-fetch to ensure robust consistency, though store action should update state.
    // No explicit fetch here as datamap states store action updates state directly.
  }, [mark_all_notifications_as_read]);

  const handleNotificationClick = useCallback(async (notification: NotificationSummary) => {
    if (!notification.is_read) {
      await mark_notification_as_read(notification.id);
      // No explicit fetch here as datamap states store action updates state directly.
    }
    navigate(`/issues/${notification.issue_key}`);
    onClose(); // Close the panel after navigating
  }, [mark_notification_as_read, navigate, onClose]);

  return (
    // Main container for the pop-over panel
    // Positioned absolutely to drop down from the notification bell
    <div
      ref={panelRef}
      className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg py-2 z-50 transform translate-x-1/4 max-h-[80vh] flex flex-col overflow-hidden"
      style={{ top: 'calc(100% + 8px)' }} // Positions the panel below the element that toggles it (e.g., bell icon)
    >
      {/* Panel Header */}
      <div className="px-4 py-2 flex justify-between items-center border-b border-gray-200 flex-shrink-0">
        <h3 className="text-lg font-semibold text-gray-800">Notifications</h3>
        {/* "Mark All as Read" button, shown only if there are unread notifications */}
        {hasUnread && notificationsToDisplay.length > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium focus:outline-none"
            type="button" // Added type for button professionalism
          >
            Mark All as Read
          </button>
        )}
      </div>

      {/* Notification List Area */}
      <div className="overflow-y-auto flex-1 p-2">
        {notificationsToDisplay.length === 0 ? (
          // Display message if there are no notifications at all
          <div className="text-center text-gray-500 py-4 px-2">
            No notifications yet.
          </div>
        ) : (
          notificationsToDisplay.map((notification) => {
            // Determine styling based on whether the notification has been read
            const isReadClass = notification.is_read ? 'bg-gray-50 text-gray-500' : 'bg-white hover:bg-gray-100 text-gray-800';
            // Construct actor's name for display (fallback to 'System' if no actor details)
            const actorName = notification.actor
              ? `${notification.actor.first_name} ${notification.actor.last_name}`
              : 'System';

            return (
              <div
                key={notification.id}
                className={`flex items-start p-2 rounded-md cursor-pointer mb-1 transition-colors duration-200 ${isReadClass}`}
                onClick={() => handleNotificationClick(notification)}
                role="button" // Added role for semantic correctness of clickable div
                tabIndex={0} // Added tabIndex for keyboard navigability
                onKeyPress={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    handleNotificationClick(notification);
                  }
                }} // Added keyboard interaction
              >
                {/* Actor's profile picture or a placeholder */}
                <div className="flex-shrink-0 mr-2">
                  <img
                    className="h-8 w-8 rounded-full object-cover"
                    src={notification.actor?.profile_picture_url || `https://picsum.photos/seed/${notification.actor?.id || notification.id}/200/200`}
                    alt={actorName}
                    onError={(e) => {
                      // Fallback image source if the primary URL fails to load
                      const target = e.target as HTMLImageElement;
                      target.onerror = null; // Prevent infinite loop on error
                      target.src = `https://picsum.photos/seed/${notification.actor?.id || 'default'}/200/200`; // Use a generic Picsum image
                    }}
                  />
                </div>
                {/* Notification summary text and timestamp */}
                <div className="flex-1">
                  <p className={`text-sm ${notification.is_read ? 'font-normal' : 'font-medium'}`}>
                    <span>{notification.summary_text}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatTimeAgo(notification.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {/* Message for when all notifications are read */}
        {notificationsToDisplay.length > 0 && !hasUnread && (
             <div className="text-center text-gray-500 py-2 text-sm">
                All caught up!
            </div>
        )}
      </div>
    </div>
  );
};

export default GV_GlobalNotificationsPanel;