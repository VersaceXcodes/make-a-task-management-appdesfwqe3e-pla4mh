import React, { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/main'; // Import the global store hook

// Assuming SNACKBAR_DISPLAY_DURATION is correctly exported from '@/store/main'
// As per the REDUX STORE IMPLEMENTATION snippet, this constant exists globally.
const SNACKBAR_DISPLAY_DURATION = 5000; // 5 seconds (fallback/explicitly defined if not from store)
// If it should strictly come from store, ensure it's exported as such from main.ts
// import { SNACKBAR_DISPLAY_DURATION } from '@/store/main';

const GV_GlobalSnackBarNotifications: React.FC = () => {
  // Access current_snackbar_message and the clear_snackbar_message action from the global store
  const { current_snackbar_message, clear_snackbar_message } = useAppStore();

  // Use useRef to store the timer ID without causing component re-renders
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Clear any existing timer to prevent multiple timers running or stale timers
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // If a new message is present, set a new timer for auto-dismissal
    if (current_snackbar_message) {
      timerRef.current = window.setTimeout(() => {
        clear_snackbar_message();
        timerRef.current = null; // Clear timer ID after dismissal
      }, SNACKBAR_DISPLAY_DURATION);
    }

    // Cleanup function: This runs when the component unmounts or when
    // 'current_snackbar_message' or 'clear_snackbar_message' dependencies change
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [current_snackbar_message, clear_snackbar_message]); // Dependencies: Re-run effect when message or clear action changes

  // If there's no message, don't render anything
  if (!current_snackbar_message) {
    return null;
  }

  // Determine styling and icon based on message type
  let backgroundColorClass: string;
  let textColorClass: string;
  let icon: React.ReactNode;

  switch (current_snackbar_message.type) {
    case 'success':
      backgroundColorClass = 'bg-green-500';
      textColorClass = 'text-white';
      icon = (
        <svg
          className="w-5 h-5 mr-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
      );
      break;
    case 'error':
      backgroundColorClass = 'bg-red-500';
      textColorClass = 'text-white';
      icon = (
        <svg
          className="w-5 h-5 mr-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
      );
      break;
    case 'info':
    default: // Default to info if type is unexpected
      backgroundColorClass = 'bg-blue-500';
      textColorClass = 'text-white';
      icon = (
        <svg
          className="w-5 h-5 mr-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
      );
      break;
  }

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-4 rounded-lg shadow-lg flex items-center justify-between min-w-80 max-w-md ${backgroundColorClass} ${textColorClass} animate-fade-in-down`}
      role="alert"
      aria-live="assertive"
      key={current_snackbar_message.id} // Key ensures re-render on new message, allowing re-trigger of animations
    >
      <div className="flex items-center">
        {icon}
        <span className="font-semibold text-sm">{current_snackbar_message.message}</span>
      </div>
      <button
        onClick={clear_snackbar_message}
        className="ml-4 p-1 rounded-full hover:bg-white hover:bg-opacity-20 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
        aria-label="Dismiss notification"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M6 18L18 6M6 6l12 12"
          ></path>
        </svg>
      </button>
    </div>
  );
};

export default GV_GlobalSnackBarNotifications;