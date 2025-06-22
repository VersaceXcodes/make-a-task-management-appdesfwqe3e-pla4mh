import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useAppStore } from '@/store/main'; // Import the Zustand store

// --- Type Definitions (from OpenAPI spec) ---

interface UserResetPasswordRequest {
  token: string;
  newPassword: string; // Renamed from new_password
}

interface ResetPasswordResponse {
  message: string;
}

// --- Constants ---
const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// --- Password Validation Utility ---
const validatePassword = (password: string): string | null => { // Renamed from validate_password
  if (password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>/?~`]/g.test(password);

  if (!hasUppercase) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!hasLowercase) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!hasNumber) {
    return 'Password must include at least one number.';
  }
  if (!hasSpecialChar) {
    return 'Password must include at least one special character.';
  }

  return null; // Password is valid
};

// --- API Call Function ---
const resetPasswordApiCall = async (payload: UserResetPasswordRequest): Promise<ResetPasswordResponse> => { // Renamed from reset_password_api_call
  const { data } = await axios.post(`${VITE_API_BASE_URL}/api/v1/auth/reset_password`, payload);
  return data;
};

// --- UV_ResetPassword Component ---

const UV_ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // add_snackbar_message follows store's snake_case; local variable will be camelCase for consistency
  const addSnackbarMessage = useAppStore((state) => state.add_snackbar_message);

  const [token, setToken] = useState<string>('');
  const [newPasswordInputValue, setNewPasswordInputValue] = useState<string>('');
  const [confirmPasswordInputValue, setConfirmPasswordInputValue] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [clientSidePasswordError, setClientSidePasswordError] = useState<string>('');
  const [clientSideConfirmPasswordError, setClientSideConfirmPasswordError] = useState<string>('');

  // Extract token from URL on component mount
  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (urlToken) {
      setToken(urlToken);
    } else {
      setErrorMessage('Password reset token is missing from the URL.');
    }
  }, [searchParams]);

  // Validate new password strength as it changes
  useEffect(() => {
    if (newPasswordInputValue.length > 0) {
      const validationError = validatePassword(newPasswordInputValue);
      setClientSidePasswordError(validationError || '');
    } else {
      setClientSidePasswordError(''); // Clear error if input is empty
    }
  }, [newPasswordInputValue]);

  // Validate confirm password matches new password as it changes
  useEffect(() => {
    if (confirmPasswordInputValue.length > 0) {
      if (newPasswordInputValue !== confirmPasswordInputValue) {
        setClientSideConfirmPasswordError('Passwords do not match.');
      } else {
        setClientSideConfirmPasswordError('');
      }
    } else {
      setClientSideConfirmPasswordError(''); // Clear error if input is empty
    }
  }, [confirmPasswordInputValue, newPasswordInputValue]);

  const resetPasswordMutation = useMutation<ResetPasswordResponse, Error, UserResetPasswordRequest>({
    mutationFn: resetPasswordApiCall,
    onSuccess: (data) => {
      setErrorMessage(''); // Clear any previous error
      addSnackbarMessage('success', data.message || 'Password reset successfully!');
      navigate('/login'); // Redirect to login page
    },
    onError: (mutationError: any) => {
      const backendErrorMessage =
        mutationError.response?.data?.message || mutationError.message || 'An unexpected error occurred.';
      setErrorMessage(backendErrorMessage);
      addSnackbarMessage('error', backendErrorMessage);
    },
  });

  const handleResetPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Re-validate all fields one last time before submission
    const passwordValidationError = validatePassword(newPasswordInputValue);
    if (passwordValidationError) {
        setClientSidePasswordError(passwordValidationError);
        return;
    }
    if (newPasswordInputValue !== confirmPasswordInputValue) {
        setClientSideConfirmPasswordError('Passwords do not match.');
        return;
    }
    if (!token) {
        setErrorMessage('Password reset token is missing from the URL. Please use the link from your email.');
        return;
    }

    // Clear previous server-side errors
    setErrorMessage('');

    resetPasswordMutation.mutate({
      token,
      newPassword: newPasswordInputValue,
    });
  };

  const isFormValid = token && !clientSidePasswordError && !clientSideConfirmPasswordError && newPasswordInputValue.length > 0 && confirmPasswordInputValue.length > 0 && newPasswordInputValue === confirmPasswordInputValue;

  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="p-8 max-w-md w-full bg-white rounded-lg shadow-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Create New Password</h2>

          {errorMessage && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
              <strong className="font-bold">Error! </strong>
              <span className="block sm:inline">{errorMessage}</span>
            </div>
          )}

          {token && !errorMessage ? ( // Only show form if token is present and no initial error
            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div>
                <label htmlFor="new_password" className="block text-sm font-medium text-gray-700">
                  New Password
                </label>
                <input
                  type="password"
                  id="new_password"
                  value={newPasswordInputValue}
                  onChange={(e) => setNewPasswordInputValue(e.target.value)}
                  className={`mt-1 block w-full px-3 py-2 border ${
                    clientSidePasswordError ? 'border-red-500' : 'border-gray-300'
                  } rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm`}
                  required
                />
                {clientSidePasswordError && (
                  <p className="mt-2 text-sm text-red-600">{clientSidePasswordError}</p>
                )}
              </div>

              <div>
                <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  id="confirm_password"
                  value={confirmPasswordInputValue}
                  onChange={(e) => setConfirmPasswordInputValue(e.target.value)}
                  className={`mt-1 block w-full px-3 py-2 border ${
                    clientSideConfirmPasswordError ? 'border-red-500' : 'border-gray-300'
                  } rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm`}
                  required
                />
                {clientSideConfirmPasswordError && (
                  <p className="mt-2 text-sm text-red-600">{clientSideConfirmPasswordError}</p>
                )}
              </div>

              <div>
                <button
                  type="submit"
                  disabled={!isFormValid || resetPasswordMutation.isLoading}
                  className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                    !isFormValid || resetPasswordMutation.isLoading ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {resetPasswordMutation.isLoading ? 'Resetting Password...' : 'Reset Password'}
                </button>
              </div>
            </form>
          ) : (
            // Display link to login if token is missing or other initial error
            <div className="text-center mt-6">
              <p className="text-gray-600 mb-4">
                Please check your email again for a valid password reset link.
              </p>
              <Link to="/login" className="text-blue-600 hover:text-blue-800 font-medium">
                Back to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default UV_ResetPassword;