import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useMutation } from '@tanstack/react-query';
import { useAppStore } from '@/store/main'; // Assuming this path is correct based on provided info

// Define interfaces for API request and response based on OpenAPI spec
interface UserRegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

interface RegisterResponse {
  message: string;
}

const UV_Register: React.FC = () => {
  // --- State Variables ---
  const [first_name_input_value, set_first_name_input_value] = useState<string>('');
  const [last_name_input_value, set_last_name_input_value] = useState<string>('');
  const [email_input_value, set_email_input_value] = useState<string>('');
  const [password_input_value, set_password_input_value] = useState<string>('');
  const [confirm_password_input_value, set_confirm_password_input_value] = useState<string>('');
  const [password_strength_indicator, set_password_strength_indicator] = useState<string>('');
  const [error_message, set_error_message] = useState<string>('');
  const [success_message, set_success_message] = useState<string>('');
  const [form_submitted, set_form_submitted] = useState<boolean>(false); // New state to track if form was attempted to be submitted

  // Global store action for snackbar notifications
  const add_snackbar_message = useAppStore((state) => state.add_snackbar_message);

  // --- Password Strength Evaluation ---
  const evaluate_password_strength = useCallback((password: string): string => {
    let strength = 0;
    if (password.length >= 8) strength++; // Base length
    if (/[A-Z]/.test(password)) strength++; // Uppercase
    if (/[a-z]/.test(password)) strength++; // Lowercase
    if (/[0-9]/.test(password)) strength++; // Digits
    if (/[^A-Za-z0-9]/.test(password)) strength++; // Special characters

    if (strength <= 1) return 'Weak';
    if (strength <= 3) return 'Medium';
    return 'Strong';
  }, []);

  useEffect(() => {
    set_password_strength_indicator(evaluate_password_strength(password_input_value));
  }, [password_input_value, evaluate_password_strength]);

  // --- Form Validation ---
  const is_email_valid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_input_value), [email_input_value]);
  const is_password_long_enough = password_input_value.length >= 8;
  const are_passwords_matching = password_input_value === confirm_password_input_value && password_input_value !== '';
  const is_form_filled = useMemo(() => {
    return [first_name_input_value, last_name_input_value, email_input_value, password_input_value, confirm_password_input_value].every(Boolean);
  }, [first_name_input_value, last_name_input_value, email_input_value, password_input_value, confirm_password_input_value]);

  const is_form_valid = useMemo(() => {
    return is_form_filled && is_email_valid && is_password_long_enough && are_passwords_matching;
  }, [is_form_filled, is_email_valid, is_password_long_enough, are_passwords_matching]);

  // --- API Call Integration with React Query ---
  const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';

  const register_user = async (user_data: UserRegisterRequest): Promise<RegisterResponse> => {
    const { data } = await axios.post<RegisterResponse>(`${API_BASE_URL}/api/v1/auth/register`, user_data);
    return data;
  };

  const { mutate, isLoading: is_loading_api, error: api_error } = useMutation<RegisterResponse, Error, UserRegisterRequest>({
    mutationFn: register_user,
    onSuccess: (data) => {
      set_success_message(data.message);
      add_snackbar_message('success', data.message);
      // Clear form inputs after successful registration
      set_first_name_input_value('');
      set_last_name_input_value('');
      set_email_input_value('');
      set_password_input_value('');
      set_confirm_password_input_value('');
      set_error_message(''); // Clear any previous local error messages
      set_form_submitted(false); // Reset form submission state on success
    },
    onError: (err: any) => {
      let message = 'An unexpected error occurred during registration.';
      if (axios.isAxiosError(err) && err.response && err.response.data && err.response.data.message) {
        message = err.response.data.message;
      }
      set_error_message(message);
      add_snackbar_message('error', message);
      set_success_message(''); // Clear any previous success message
      set_form_submitted(true); // Keep `form_submitted` true to show validation errors
    },
  });

  // Combine local and API loading states
  const is_loading = is_loading_api;

  // --- Form Submission Handler ---
  const handle_register_submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    set_form_submitted(true); // Indicate that a submission attempt has been made
    set_error_message(''); // Clear previous error messages for new attempt
    set_success_message(''); // Clear previous success messages

    if (!is_form_valid) {
      set_error_message('Please correct the form errors before submitting.');
      return;
    }

    mutate({
      first_name: first_name_input_value,
      last_name: last_name_input_value,
      email: email_input_value,
      password: password_input_value,
    });
  }, [first_name_input_value, last_name_input_value, email_input_value, password_input_value, is_form_valid, mutate]);

  // Determine password strength text color
  const strength_color_class = useMemo(() => {
    switch (password_strength_indicator) {
      case 'Weak': return 'text-red-500';
      case 'Medium': return 'text-yellow-500';
      case 'Strong': return 'text-green-500';
      default: return 'text-gray-500';
    }
  }, [password_strength_indicator]);

  return (
    <>
      <div className="flex min-h-full items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 p-8 bg-white rounded-lg shadow-md">
          {/* Logo and Header Section */}
          <div>
            <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
              AetherFlow
            </h2>
            <h2 className="mt-2 text-center text-2xl font-bold tracking-tight text-gray-800">
              Create Your AetherFlow Account
            </h2>
          </div>

          {/* Registration Form */}
          <form className="mt-8 space-y-6" onSubmit={handle_register_submit}>
            {/* Error/Success Messages */}
            {error_message && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                <span className="block sm:inline">{error_message}</span>
              </div>
            )}
            {success_message && (
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative" role="alert">
                <span className="block sm:inline">{success_message}</span>
              </div>
            )}

            {/* Input Fields */}
            <div className="rounded-md shadow-sm -space-y-px">
              {/* First Name */}
              <div>
                <label htmlFor="first-name" className="sr-only">First Name</label>
                <input
                  id="first-name"
                  name="first_name"
                  type="text"
                  autoComplete="given-name"
                  required
                  className={`relative block w-full appearance-none rounded-none rounded-t-md border px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm ${((!first_name_input_value || first_name_input_value.trim() === '') && form_submitted) ? 'border-red-500' : ''}`}
                  placeholder="First Name"
                  value={first_name_input_value}
                  onChange={(e) => set_first_name_input_value(e.target.value)}
                />
                {((!first_name_input_value || first_name_input_value.trim() === '') && form_submitted) && (
                  <p className="text-red-500 text-xs italic px-3">First Name is required.</p>
                )}
              </div>
              {/* Last Name */}
              <div>
                <label htmlFor="last-name" className="sr-only">Last Name</label>
                <input
                  id="last-name"
                  name="last_name"
                  type="text"
                  autoComplete="family-name"
                  required
                  className={`relative block w-full appearance-none rounded-none border px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm ${((!last_name_input_value || last_name_input_value.trim() === '') && form_submitted) ? 'border-red-500' : ''}`}
                  placeholder="Last Name"
                  value={last_name_input_value}
                  onChange={(e) => set_last_name_input_value(e.target.value)}
                />
                {((!last_name_input_value || last_name_input_value.trim() === '') && form_submitted) && (
                  <p className="text-red-500 text-xs italic px-3">Last Name is required.</p>
                )}
              </div>
              {/* Email Address */}
              <div>
                <label htmlFor="email-address" className="sr-only">Email address</label>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={`relative block w-full appearance-none rounded-none border px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm ${((!is_email_valid && email_input_value.length > 0) || ((!email_input_value || email_input_value.trim() === '') && form_submitted)) ? 'border-red-500' : ''}`}
                  placeholder="Email address"
                  value={email_input_value}
                  onChange={(e) => set_email_input_value(e.target.value)}
                />
                {((!email_input_value || email_input_value.trim() === '') && form_submitted) ? (
                  <p className="text-red-500 text-xs italic px-3">Email address is required.</p>
                ) : (!is_email_valid && email_input_value.length > 0) ? (
                  <p className="text-red-500 text-xs italic px-3">Please enter a valid email address.</p>
                ) : null}
              </div>
              {/* Password */}
              <div>
                <label htmlFor="password" className="sr-only">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={`relative block w-full appearance-none rounded-none border px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm ${((!is_password_long_enough && password_input_value.length > 0) || ((!password_input_value || password_input_value.trim() === '') && form_submitted)) ? 'border-red-500' : ''}`}
                  placeholder="Password (min 8 characters)"
                  value={password_input_value}
                  onChange={(e) => set_password_input_value(e.target.value)}
                />
                {password_input_value.length > 0 && (
                  <div className="text-xs mt-1 px-3">
                    Password Strength: <span className={strength_color_class}>{password_strength_indicator}</span>
                  </div>
                )}
                 {((!password_input_value || password_input_value.trim() === '') && form_submitted) ? (
                  <p className="text-red-500 text-xs italic px-3">Password is required.</p>
                ) : (!is_password_long_enough && password_input_value.length > 0) ? (
                  <p className="text-red-500 text-xs italic px-3">Password must be at least 8 characters long.</p>
                ) : null}
              </div>
              {/* Confirm Password */}
              <div>
                <label htmlFor="confirm-password" className="sr-only">Confirm Password</label>
                <input
                  id="confirm-password"
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={`relative block w-full appearance-none rounded-none rounded-b-md border px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm ${((!are_passwords_matching && confirm_password_input_value.length > 0) || ((!confirm_password_input_value || confirm_password_input_value.trim() === '') && form_submitted)) ? 'border-red-500' : ''}`}
                  placeholder="Confirm Password"
                  value={confirm_password_input_value}
                  onChange={(e) => set_confirm_password_input_value(e.target.value)}
                />
                {((!confirm_password_input_value || confirm_password_input_value.trim() === '') && form_submitted) ? (
                  <p className="text-red-500 text-xs italic px-3">Confirm Password is required.</p>
                ) : (!are_passwords_matching && confirm_password_input_value.length > 0) ? (
                  <p className="text-red-500 text-xs italic px-3">Passwords do not match.</p>
                ) : null}
              </div>
            </div>

            {/* Sign Up Button */}
            <div>
              <button
                type="submit"
                disabled={!is_form_valid || is_loading}
                className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {is_loading ? 'Signing Up...' : 'Sign Up'}
              </button>
            </div>
          </form>

          {/* Login Link */}
          <div className="text-center text-sm">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
              Login
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default UV_Register;