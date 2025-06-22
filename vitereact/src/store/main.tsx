import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import axios, { AxiosInstance } from 'axios';
import { io, Socket } from 'socket.io-client';

// --- Environment Variables ---
const VITE_API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';
const VITE_WS_BASE_URL: string = (import.meta.env.VITE_WS_BASE_URL as string) || 'http://localhost:3000'; // Assuming WS runs on same port as HTTP server based on BRD

// --- Global Axios Instance ---
let api_client: AxiosInstance;

// --- Global Socket.IO Instance ---
let global_socket_instance: Socket | null = null;

// --- Helper for Snackbar Auto-Dismiss ---
let snackbar_timeout_id: NodeJS.Timeout | null = null;
const SNACKBAR_DISPLAY_DURATION = 5000; // 5 seconds

// --- Type Definitions (from app:architecture and OpenAPI) ---

// User Types
export interface UserResponse {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

export interface UserSummary {
  id: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
}

// Project Types
export type ProjectRole = 'Admin' | 'Member';

export interface ProjectListResponse {
  id: string;
  project_name: string;
  project_key: string;
  description: string | null;
  project_lead: UserSummary;
  created_at: string; // ISO 8601 datetime string
  updated_at: string; // ISO 8601 datetime string
  user_role: ProjectRole;
}

// Notification Types
export interface NotificationCommentSummary {
  id: string;
  content: string;
}

export type NotificationType =
  | 'assigned_to_you'
  | 'new_comment'
  | 'status_change'
  | 'mentioned'
  | 'issue_updated'
  | 'issue_created' // Added based on BRD backend `action_type` for notifications
  | 'issue_linked'   // Added based on BRD backend `action_type` for notifications
  | 'issue_unlinked'; // Added based on BRD backend `action_type` for notifications

export interface NotificationSummary {
  id: string;
  issue_id: string;
  issue_key: string;
  issue_summary: string;
  project_key: string;
  notification_type: NotificationType;
  actor: UserSummary | null;
  comment: NotificationCommentSummary | null;
  summary_text: string;
  is_read: boolean;
  created_at: string; // ISO 8601 datetime string
}

export interface NotificationsResponse {
  unread_count: number;
  notifications: NotificationSummary[];
}

// Snackbar Type
export interface SnackbarMessage {
  type: 'success' | 'error' | 'info';
  message: string;
  id: string; // Unique ID for keying multiple messages if queued
}

// Global App Store State
export interface AppStoreState {
  authenticated_user: UserResponse | null;
  auth_token: string | null;
  my_projects: ProjectListResponse[];
  global_notifications: NotificationsResponse;
  current_snackbar_message: SnackbarMessage | null;
  global_loading_indicator: boolean;
}

// Global App Store Actions
export interface AppStoreActions {
  // Authentication & User Management
  login: (user_id: string, token: string) => Promise<void>;
  logout: () => void;

  // Global UI State Management
  set_global_loading: (status: boolean) => void;
  add_snackbar_message: (type: SnackbarMessage['type'], message: string) => void;
  clear_snackbar_message: () => void;

  // Project Data Management
  fetch_my_projects: () => Promise<void>;
  update_my_projects: (project_id: string, updates: Partial<ProjectListResponse>) => void;
  remove_my_project: (project_id: string) => void;

  // Notification Management
  fetch_global_notifications: () => Promise<void>;
  mark_notification_as_read: (notification_id: string) => Promise<void>;
  mark_all_notifications_as_read: () => Promise<void>;

  // Real-time Socket.IO Access
  get_socket_instance: () => Socket | null;

  // (Internal) Initialize/Configure Axios and Socket.IO
  _initialize_axios_and_socket: (token: string | null) => void;
  _subscribe_global_socket_events: () => void;
  _disconnect_socket: () => void;
}

export type AppStore = AppStoreState & AppStoreActions;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => {
      // --- Initialize API Client ---
      // This ensures api_client is always available even if not authenticated initially
      api_client = axios.create({
        baseURL: VITE_API_BASE_URL,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return {
        // --- State Variables ---
        authenticated_user: null,
        auth_token: null,
        my_projects: [],
        global_notifications: { unread_count: 0, notifications: [] },
        current_snackbar_message: null,
        global_loading_indicator: false,

        // --- (Internal) Initialize/Configure Axios and Socket.IO ---
        // This function manages the Axios default header and the Socket.IO connection lifecycle.
        _initialize_axios_and_socket: (token: string | null) => {
          // Configure Axios
          if (token) {
            api_client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          } else {
            delete api_client.defaults.headers.common['Authorization'];
          }

          // Manage Socket.IO Connection
          const current_socket_is_connected = global_socket_instance?.connected;

          if (token && !current_socket_is_connected) {
            // Connect a new socket instance only if a token is provided and no active connection
            console.log('Attempting to connect Socket.IO...');
            global_socket_instance = io(VITE_WS_BASE_URL, {
              auth: { token },
              transports: ['websocket'], // Prefer websocket
            });

            // Set up global listeners
            global_socket_instance.on('connect', () => {
              console.log('Socket.IO connected. User ID from token:', global_socket_instance?.auth?.token);
              get()._subscribe_global_socket_events(); // Subscribe to global app events
              // Attempt to join personal notification room (backend handles 'users/{user_id}/notifications')
              const user_id = get().authenticated_user?.id;
              if (user_id) {
                global_socket_instance?.emit('join_user_notifications_room', user_id);
              }
            });

            global_socket_instance.on('disconnect', (reason) => {
              console.log('Socket.IO disconnected:', reason);
              get().add_snackbar_message('info', `Realtime connection lost: ${reason}.`);
            });

            global_socket_instance.on('connect_error', (err) => {
              console.error('Socket.IO connection error:', err.message);
              get().add_snackbar_message('error', `Realtime connection error: ${err.message}`);
            });
          } else if (!token && current_socket_is_connected) {
            // Disconnect socket if token is removed and a connection is active
            get()._disconnect_socket();
          }
        },

        // Sets up listeners for global WebSocket events that affect the store's state.
        _subscribe_global_socket_events: () => {
            if (!global_socket_instance) return;

            // Remove any existing listeners to prevent duplicates on reconnect
            global_socket_instance.off('notification_new_unread');

            console.log('Subscribing to global socket events...');
            global_socket_instance.on('notification_new_unread', (event: { type: 'notification_new_unread', data: NotificationSummary }) => {
              console.log('Received notification_new_unread event:', event.data);
              set((state) => ({
                global_notifications: {
                  ...state.global_notifications,
                  unread_count: state.global_notifications.unread_count + 1,
                  // Add new notification to the beginning of the array for chronological display
                  notifications: [event.data, ...state.global_notifications.notifications].slice(0, 100), // Cap notifications list size
                },
              }));
              get().add_snackbar_message('info', event.data.summary_text); // Display a snackbar for the new notification
            });
        },

        // Disconnects the global Socket.IO instance.
        _disconnect_socket: () => {
          if (global_socket_instance) {
            global_socket_instance.disconnect();
            global_socket_instance.removeAllListeners(); // Clean up all listeners
            global_socket_instance = null;
            console.log('Socket.IO instance destroyed.');
          }
        },

        // Public getter for the Socket.IO instance, allowing components to subscribe to specific rooms.
        get_socket_instance: () => global_socket_instance,

        // --- Actions ---

        // Handles user login: sets token, configures Axios/Socket, fetches user data, projects, and notifications.
        login: async (user_id: string, token: string) => {
          set({ auth_token: token }); // Set token immediately
          get()._initialize_axios_and_socket(token); // Configure Axios and connect socket with new token

          try {
            // Fetch full user details using the newly set authenticated Axios client
            const user_response = await api_client.get<UserResponse>('/api/v1/users/me');
            set({ authenticated_user: user_response.data });
            console.log('Logged in successfully. User email:', user_response.data.email);

            // Fetch initial global data sets for the authenticated user
            await get().fetch_my_projects();
            await get().fetch_global_notifications();

            get().add_snackbar_message('success', `Welcome, ${user_response.data.first_name || user_response.data.email}!`);

          } catch (error) {
            console.error('Login process failed after token received (fetching user details or initial data):', error);
            // If subsequent data fetches fail or token is invalid, log out to ensure consistent state
            get().add_snackbar_message('error', 'Login incomplete: Could not retrieve full user profile or projects. Please try again.');
            get().logout();
          }
        },

        // Handles user logout: clears auth-related state, disconnects socket, and clears Axios headers.
        logout: () => {
          set({
            authenticated_user: null,
            auth_token: null,
            my_projects: [],
            global_notifications: { unread_count: 0, notifications: [] },
          });
          get()._initialize_axios_and_socket(null); // Clear Axios auth header and disconnect socket
          get().add_snackbar_message('info', 'You have been logged out.');
          console.log('User logged out.');
        },

        // Sets the global loading indicator status.
        set_global_loading: (status) => {
          set({ global_loading_indicator: status });
        },

        // Adds a new snackbar message and sets a timeout to clear it automatically.
        add_snackbar_message: (type, message) => {
          set({ current_snackbar_message: { type, message, id: Date.now().toString() } });
          // Clear any existing timeout to ensure the new message is displayed for the full duration
          if (snackbar_timeout_id) {
            clearTimeout(snackbar_timeout_id);
          }
          snackbar_timeout_id = setTimeout(() => {
            get().clear_snackbar_message();
          }, SNACKBAR_DISPLAY_DURATION);
        },

        // Clears the current snackbar message.
        clear_snackbar_message: () => {
          set({ current_snackbar_message: null });
          if (snackbar_timeout_id) {
            clearTimeout(snackbar_timeout_id);
            snackbar_timeout_id = null;
          }
        },

        // Fetches all projects the authenticated user is a member of.
        fetch_my_projects: async () => {
          const { auth_token, authenticated_user } = get();
          // Do not fetch if not authenticated
          if (!auth_token || !authenticated_user) {
            set({ my_projects: [] });
            return;
          }
          get().set_global_loading(true); // Indicate global loading
          try {
            const response = await api_client.get<ProjectListResponse[]>('/api/v1/projects');
            set({ my_projects: response.data });
          } catch (error) {
            console.error('Failed to fetch user projects:', error);
            get().add_snackbar_message('error', 'Failed to load your projects.');
            set({ my_projects: [] }); // Clear projects on error to prevent stale data
            // If unauthorized, trigger logout
            if (axios.isAxiosError(error) && error.response?.status === 401) {
              get().logout();
            }
          } finally {
            get().set_global_loading(false); // End global loading
          }
        },

        // Updates a specific project's details within the 'my_projects' array.
        update_my_projects: (project_id, updates) => {
          set((state) => ({
            my_projects: state.my_projects.map((project) =>
              project.id === project_id ? { ...project, ...updates } : project
            ),
          }));
        },

        // Removes a project from the 'my_projects' array.
        remove_my_project: (project_id) => {
          set((state) => ({
            my_projects: state.my_projects.filter((project) => project.id !== project_id),
          }));
        },

        // Fetches global in-app notifications for the authenticated user.
        fetch_global_notifications: async () => {
          const { auth_token, authenticated_user } = get();
          // Do not fetch if not authenticated
          if (!auth_token || !authenticated_user) {
            set({ global_notifications: { unread_count: 0, notifications: [] } });
            return;
          }
          try {
            const response = await api_client.get<NotificationsResponse>('/api/v1/users/me/notifications');
            set({ global_notifications: response.data });
          } catch (error) {
            console.error('Failed to fetch global notifications:', error);
            get().add_snackbar_message('error', 'Failed to load notifications.');
            set({ global_notifications: { unread_count: 0, notifications: [] } }); // Clear notifications on error
            // If unauthorized, trigger logout
             if (axios.isAxiosError(error) && error.response?.status === 401) {
              get().logout();
            }
          }
        },

        // Marks a specific notification as read via API and updates local state.
        mark_notification_as_read: async (notification_id) => {
          try {
            await api_client.put(`/api/v1/notifications/${notification_id}/read`);
            set((state) => {
              const updated_notifications = state.global_notifications.notifications.map((n) =>
                n.id === notification_id ? { ...n, is_read: true } : n
              );
              // Decrement unread count, but ensure it doesn't go below zero
              const new_unread_count = state.global_notifications.unread_count > 0 ? state.global_notifications.unread_count - 1 : 0;
              return {
                global_notifications: {
                  unread_count: new_unread_count,
                  notifications: updated_notifications,
                },
              };
            });
          } catch (error) {
            console.error('Failed to mark notification as read:', error);
            get().add_snackbar_message('error', 'Failed to mark notification as read.');
          }
        },

        // Marks all unread notifications for the user as read via API and updates local state.
        mark_all_notifications_as_read: async () => {
          try {
            await api_client.put('/api/v1/notifications/mark_all_as_read');
            set((state) => ({
              global_notifications: {
                unread_count: 0,
                notifications: state.global_notifications.notifications.map((n) => ({ ...n, is_read: true })),
              },
            }));
          } catch (error) {
            console.error('Failed to mark all notifications as read:', error);
            get().add_snackbar_message('error', 'Failed to mark all notifications as read.');
          }
        },
      };
    },
    {
      name: 'aetherflow-storage', // The name of the item in localStorage
      storage: createJSONStorage(() => localStorage), // Use localStorage for persistence
      // 'partialize' specifies which parts of the state should be persisted
      partialize: (state) => ({
        authenticated_user: state.authenticated_user,
        auth_token: state.auth_token,
      }),
      // 'onRehydrateStorage' is called when the persisted state is rehydrated from storage.
      // This is crucial for re-initializing Axios headers and Socket.IO connection after an app reload.
      onRehydrateStorage: (state) => {
        return (storedState) => {
          if (storedState?.auth_token) {
            // Reinitialize Axios and Socket.IO using the retrieved token
            console.log('Rehydrating store and re-initializing APIs/Sockets...');
            storedState._initialize_axios_and_socket(storedState.auth_token);

            // After rehydration, refetch dynamic data (projects and full notifications) which are not persisted
            // This ensures the data is fresh when the user returns to the app.
            // These calls are made directly from the `storedState` object which is the rehydrated store instance.
            const { fetch_my_projects, fetch_global_notifications } = storedState;
            fetch_my_projects();
            fetch_global_notifications();
          }
        };
      },
    })
);