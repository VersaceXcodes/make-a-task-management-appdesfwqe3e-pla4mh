import React from 'react';
import { Link } from 'react-router-dom';

/**
 * UV_EmailVerificationFailed: Email Verification Failed Page
 * This static page is displayed to the user if they click an invalid or expired email verification link.
 * It informs the user of the failure and provides a link to return to the login page.
 */
const UV_EmailVerificationFailed: React.FC = () => {
  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-4 bg-gray-100 text-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full border border-red-200">
          <svg
            className="mx-auto h-16 w-16 text-red-500"
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
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Email Verification Failed
          </h2>
          <p className="mt-4 text-sm text-gray-600">
            Verification failed or the link has expired.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Please try registering again or contact support if the issue persists.
          </p>
          <div className="mt-6">
            <Link
              to="/login"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 ease-in-out"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default UV_EmailVerificationFailed;