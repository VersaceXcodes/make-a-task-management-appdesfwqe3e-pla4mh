import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { z } from 'zod'; // For robust email validation
import { useAppStore } from '@/store/main'; // For global snackbar notifications

// Define base URL from environment variables
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';

// ------------------------------------
// Type Definitions for API Interaction
// ------------------------------------

interface ForgotPasswordPayload {
  email: string;
}

interface ForgotPasswordResponse {
  message: string;
}

// ------------------------------------
// Zod Schema for Email Validation
// ------------------------------------
const emailSchema = z.string().email('Please enter a valid email address.');

// ------------------------------------
// API Call Function
// ------------------------------------
const sendResetLink = async (payload: ForgotPasswordPayload): Promise<ForgotPasswordResponse> => {
  const { data } = await axios.post<ForgotPasswordResponse>(
    `${API_BASE_URL}/api/v1/auth/forgot_password`,
    payload
  );
  return data;
};

// ------------------------------------
// React Component: UV_ForgotPasswordRequest
// ------------------------------------
const UV_ForgotPasswordRequest: React.FC = () => {
  const [email_input_value, set_email_input_value] = useState<string>('');
  const [error_message, set_error_message] = useState<string>(''); // Renamed from local_error_message
  const [success_message, set_success_message] = useState<string>('');

  const add_snackbar_message = useAppStore((state) => state.add_snackbar_message);

  // Email validation check for button disablement only
  const is_email_valid = emailSchema.safeParse(email_input_value).success;
  const is_button_disabled = !is_email_valid;

  // React Query Mutation Hook
  const forgot_password_mutation = useMutation<ForgotPasswordResponse, Error, ForgotPasswordPayload>({
    mutationFn: sendResetLink,
    onSuccess: () => {
      // Per SITEMAP, always show the generic success message for security.
      set_success_message('If an account with that email exists, a password reset link has been sent.');
      set_error_message(''); // Clear any previous errors
      add_snackbar_message('success', 'Password reset requested.'); // Generic snackbar message
    },
    onError: (error) => {
      set_success_message(''); // Clear success message on error

      if (axios.isAxiosError(error) && error.response) {
        // CRITICAL FIX: Handle 404 response specifically for security
        if (error.response.status === 404) {
          set_success_message('If an account with that email exists, a password reset link has been sent.');
          set_error_message(''); // Ensure no error message is shown
          add_snackbar_message('success', 'Password reset requested.'); // Generic snackbar for 404 as well
        } else {
          // For any other Axios errors (e.g., 500, 400 not covered by 404 security handling)
          const apiErrorMessage = error.response.data?.message
            ? String(error.response.data.message)
            : 'An unexpected error occurred. Please try again.';
          set_error_message(apiErrorMessage);
          add_snackbar_message('error', apiErrorMessage);
        }
      } else {
        // For non-Axios errors or generic network issues
        set_error_message('A network error occurred. Please check your internet connection.');
        add_snackbar_message('error', 'A network error occurred. Please check your internet connection.');
      }
    },
  });

  const handle_submit = (e: React.FormEvent) => {
    e.preventDefault();
    set_error_message(''); // Clear previous error messages before new submission.
    set_success_message(''); // Clear previous success messages before new submission.

    const validationResult = emailSchema.safeParse(email_input_value);
    if (!validationResult.success) {
      set_error_message(validationResult.error.errors[0].message); // Set error message from Zod
      return;
    }

    forgot_password_mutation.mutate({ email: email_input_value });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h2 className="text-center text-3xl font-bold text-gray-900">Reset Your Password</h2>
        <p className="mt-2 text-center text-gray-600">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        <form className="mt-8 space-y-6" onSubmit={handle_submit}>
          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={`relative block w-full appearance-none rounded-md border px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm ${
                error_message ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Email address"
              value={email_input_value}
              onChange={(e) => {
                set_email_input_value(e.target.value);
                // Clear error message once user starts typing again, only if there's an active error
                if (error_message) set_error_message('');
              }}
            />
            {/* Consolidated error message display */}
            {error_message && (
              <p className="mt-2 text-sm text-red-600">{error_message}</p>
            )}
            {success_message && (
              <p className="mt-2 text-sm text-green-600">{success_message}</p>
            )}
          </div>

          <div>
            <button
              type="submit"
              className={`group relative flex w-full justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                is_button_disabled || forgot_password_mutation.isLoading ? 'cursor-not-allowed opacity-60' : ''
              }`}
              disabled={is_button_disabled || forgot_password_mutation.isLoading}
            >
              {forgot_password_mutation.isLoading ? (
                <svg
                  className="-ml-1 mr-3 h-5 w-5 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12V4a8 8 0 0116 0v8z"
                  ></path>
                </svg>
              ) : null}
              {forgot_password_mutation.isLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </div>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default UV_ForgotPasswordRequest;