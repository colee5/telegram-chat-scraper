'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface Message {
  id: number;
  text: string;
  date: number;
  fromId?: string;
  replyToMsgId?: number;
}

interface StreamData {
  type: 'connected' | 'message' | 'error' | 'ping';
  error?: string;
  timestamp?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export default function MessageList() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPing, setLastPing] = useState<number>(Date.now());

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isActiveRef = useRef(true);

  // Handle visibility change to reconnect when tab becomes active
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !eventSourceRef.current) {
        console.log('Tab became visible, reconnecting...');
        setupEventStream();
      } else if (document.visibilityState === 'hidden') {
        console.log('Tab hidden');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Monitor connection health
  useEffect(() => {
    const checkConnection = setInterval(() => {
      const now = Date.now();
      const timeSinceLastPing = now - lastPing;

      // If no ping for 45 seconds, reconnect
      if (timeSinceLastPing > 45000 && connected) {
        console.log('Connection timeout, reconnecting...');
        setConnected(false);
        reconnect();
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(checkConnection);
  }, [lastPing, connected]);

  const fetchMessages = async () => {
    try {
      setError(null);
      const response = await fetch('/api/telegram/messages');
      const data = await response.json();

      if (data.success) {
        setMessages(data.messages);
      } else {
        setError(data.error || 'Failed to fetch messages');
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Exponential backoff for reconnection
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttemptsRef.current),
      30000
    );
    console.log(
      `Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`
    );

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isActiveRef.current && document.visibilityState === 'visible') {
        setupEventStream();
        reconnectAttemptsRef.current++;
      }
    }, delay);
  }, []);

  const setupEventStream = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    console.log('Setting up EventSource connection...');
    const eventSource = new EventSource('/api/telegram/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('EventSource connection opened');
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
    };

    eventSource.onmessage = (event) => {
      try {
        const data: StreamData = JSON.parse(event.data);

        switch (data.type) {
          case 'connected':
            setConnected(true);
            setError(null);
            setLastPing(Date.now());
            console.log('Connected to Telegram stream');
            break;

          case 'message':
            const newMessage: Message = {
              id: data.id,
              text: data.text,
              date: data.date,
              fromId: data.fromId,
              replyToMsgId: data.replyToMsgId,
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMessage.id)) {
                return prev;
              }
              return [newMessage, ...prev].slice(0, 100); // Keep last 100 messages
            });
            break;

          case 'error':
            console.error('Stream error:', data.error);
            setError(data.error || 'Stream error occurred');
            setConnected(false);
            break;

          case 'ping':
            setLastPing(Date.now());
            break;
        }
      } catch (error) {
        console.error('Error parsing stream data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      setConnected(false);
      eventSourceRef.current = null;

      // Only reconnect if tab is visible and component is active
      if (isActiveRef.current && document.visibilityState === 'visible') {
        reconnect();
      }
    };
  }, [reconnect]);

  useEffect(() => {
    isActiveRef.current = true;
    fetchMessages();

    // Setup streaming after initial fetch
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        setupEventStream();
      }
    }, 1000);

    return () => {
      isActiveRef.current = false;
      clearTimeout(timer);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [setupEventStream]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading messages...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Telegram General Topic</h1>
        <div className="flex items-center gap-4 mt-2">
          <span
            className={`text-sm ${
              connected ? 'text-green-500' : 'text-gray-400'
            }`}
          >
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
          <span className="text-sm text-gray-500">
            {messages.length} messages
          </span>
          <button
            onClick={() => {
              fetchMessages();
              reconnect();
              toast.success('Revalidated');
            }}
            className="text-sm cursor-pointer text-blue-500 hover:text-blue-700"
          >
            Refresh
          </button>
        </div>
        {error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="space-y-2  overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No messages found in this topic
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">
                    User: {message.fromId || 'Unknown'}
                  </span>
                  {message.replyToMsgId && (
                    <span className="text-xs text-blue-500">
                      Reply to #{message.replyToMsgId}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(message.date * 1000).toLocaleString()}
                </span>
              </div>
              <p className="text-gray-800 whitespace-pre-wrap break-words">
                {message.text}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
