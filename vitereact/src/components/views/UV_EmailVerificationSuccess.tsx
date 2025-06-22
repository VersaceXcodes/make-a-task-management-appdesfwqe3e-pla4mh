import React from 'react';
import { Link } from 'react-router-dom';

/**
 * UV_EmailVerificationSuccess Component
 * Displays a success message after a user's email has been successfully verified.
 * Provides a link to navigate back to the login page.
 */
const UV_EmailVerificationSuccess: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full text-center">
        <div className="text-green-500 mb-4">
          <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-4">
          Verification Successful!
        </h1>
        <p className="text-gray-700 mb-6 text-lg">
          Your email has been successfully verified.
        </p>
        <p className="text-gray-600 mb-8">
          You can now log in to your AetherFlow account to start managing your tasks.
        </p>
        <Link to="/login" className="w-full inline-flex justify-center py-3 px-6 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition ease-in-out duration-150">
          Go to Login
        </Link>
      </div>
    </div>
  );
};

export default UV_EmailVerificationSuccess;