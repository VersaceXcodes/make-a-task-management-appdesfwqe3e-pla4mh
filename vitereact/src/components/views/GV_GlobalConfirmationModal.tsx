import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/main'; // Import the global store
import { AxiosError } from 'axios';

/**
 * GV_GlobalConfirmationModal Component
 * A generic, global confirmation modal for irreversible or critical actions.
 * Its visibility and content are controlled via the Zustand global store.
 */
const GV_GlobalConfirmationModal: React.FC = () => {
  // Destructure relevant state and actions from the global store
  const {
    is_modal_open,
    modal_title,
    modal_message,
    confirm_input_required,
    confirmation_string_expected,
    on_confirm_callback,
    data_for_callback,
    close_confirmation_modal,
    set_global_loading,
    add_snackbar_message,
  } = useAppStore(state => ({
    // Destructure directly from confirmation_modal and top-level actions
    ...state.confirmation_modal,
    close_confirmation_modal: state.close_confirmation_modal,
    set_global_loading: state.set_global_loading,
    add_snackbar_message: state.add_snackbar_message,
  }));

  // Local state for the confirmation input field
  const [confirmation_string_input, set_confirmation_string_input] = useState('');
  // State to manage internal loading for the button (e.g., "Processing...")
  const [is_executing, set_is_executing] = useState(false);

  // Clear local state when the modal opens, reset execution state
  useEffect(() => {
    if (is_modal_open) {
      set_confirmation_string_input('');
      set_is_executing(false);
    }
  }, [is_modal_open]); // Only re-run if modal open state changes

  // Handle changes in the confirmation input field
  // Memoize using useCallback for performance if this component re-renders frequently
  const handle_confirm_input_change = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    set_confirmation_string_input(e.target.value);
  }, []);

  // Determine if the confirm button should be enabled
  // Memoize using useMemo for performance if dependencies are stable
  const is_confirm_button_enabled = useMemo(() => {
    return confirm_input_required
      ? confirmation_string_input === confirmation_string_expected
      : true;
  }, [confirm_input_required, confirmation_string_input, confirmation_string_expected]);

  // Execute the confirmed action
  const execute_confirmed_action = useCallback(async () => {
    // Prevent execution if button is disabled, callback is missing, or already executing
    if (!is_confirm_button_enabled || !on_confirm_callback || is_executing) {
      return;
    }

    set_is_executing(true); // Set local loading for the button
    set_global_loading(true); // Set global loading indicator

    try {
      // Execute the provided callback function.
      // Cast on_confirm_callback to ensure it's treated as a function that accepts data_for_callback
      // and can potentially return a Promise. The datamap schema is misleading here.
      // The `data_for_callback` is guaranteed to be an object per datamap default.
      const callbackResult = (on_confirm_callback as (data: object) => Promise<void> | void)(data_for_callback);

      // If the callback returns a Promise, await it
      if (callbackResult instanceof Promise) {
        await callbackResult;
      }

      // Callback is responsible for adding its own success snackbar.
      // Close modal ONLY on successful execution as per VIEW SITEMAP.
      close_confirmation_modal();
    } catch (error) {
      // Type 'unknown' is safer than 'any' for catch block errors
      const axiosError = error instanceof AxiosError ? error : null;
      console.error('Confirmation action failed:', error);
      // Display generic error message if the specific callback didn't handle it
      add_snackbar_message(
        'error',
        axiosError?.response?.data?.message || 'An unexpected error occurred during confirmation.'
      );
      // Do NOT close the modal on error, allow the user to see the error message and potentially retry.
    } finally {
      // Reset loading states regardless of success or failure
      set_global_loading(false);
      set_is_executing(false);
    }
  }, [
    is_confirm_button_enabled,
    on_confirm_callback,
    is_executing,
    data_for_callback,
    close_confirmation_modal,
    set_global_loading,
    add_snackbar_message,
  ]);

  // If the modal is not open, render nothing
  if (!is_modal_open) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-gray-900 bg-opacity-50 transition-opacity duration-300"
        aria-hidden="true"
        onClick={close_confirmation_modal} // Close modal on backdrop click
      ></div>

      {/* Modal Dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-transform duration-300 transform scale-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-modal-title"
      >
        <div
          className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-auto py-6 px-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="text-center mb-6">
            <h3 id="confirmation-modal-title" className="text-xl font-semibold text-gray-900">
              {modal_title}
            </h3>
          </div>

          {/* Body */}
          <div className="mb-6 text-center">
            <p className="text-gray-700 leading-relaxed max-h-48 overflow-y-auto">
              {modal_message}
            </p>

            {confirm_input_required && (
              <div className="mt-6 flex flex-col items-center">
                <p className="text-sm text-gray-600 mb-2">
                  To confirm, please type "<span className="font-bold text-gray-800">{confirmation_string_expected}</span>" below:
                </p>
                <input
                  type="text"
                  placeholder={confirmation_string_expected}
                  value={confirmation_string_input}
                  onChange={handle_confirm_input_change}
                  className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm text-center"
                  aria-label="Confirm action by typing name"
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex justify-center flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
            <button
              type="button"
              className="w-full sm:w-auto px-6 py-2 border border-gray-300 rounded-md shadow-sm text-base font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
              onClick={close_confirmation_modal}
              disabled={is_executing}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`w-full sm:w-auto px-6 py-2 tracking-wide rounded-md shadow-sm text-base font-medium text-white ${
                is_confirm_button_enabled
                  ? 'bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'
                  : 'bg-red-300 cursor-not-allowed'
              } transition-colors duration-200`}
              onClick={execute_confirmed_action}
              disabled={!is_confirm_button_enabled || is_executing}
            >
              {is_executing ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin -ml-1 mr-3 h-5 w-5 border-b-2 border-white rounded-full"></div>
                  Processing...
                </div>
              ) : (
                modal_title.includes('Delete') ? 'Delete' : 'Confirm'
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default GV_GlobalConfirmationModal;