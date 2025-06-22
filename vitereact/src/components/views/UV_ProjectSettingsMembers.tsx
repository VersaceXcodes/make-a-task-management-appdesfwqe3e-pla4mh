import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore, api_client } from '@/store/main'; // Assuming api_client is globally exported and configured with token interceptors
import { AxiosError } from 'axios';
import axios from 'axios';
import { Dialog, Transition } from '@headlessui/react';
import { UserPlusIcon, TrashIcon } from '@heroicons/react/24/outline'; // Removed UserMinusIcon

// --- Custom Hook: useDebounce ---
// Simple debounce hook for search inputs
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}