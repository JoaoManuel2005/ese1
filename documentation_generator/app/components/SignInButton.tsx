"use client";

import { signIn, signOut, useSession } from 'next-auth/react';
import { BASE_LOGIN_AUTHORIZATION_PARAMS } from "../auth/authRequests";

export default function SignInButton() {
  const { data: session, status } = useSession();
  const loading = status === 'loading';

  if (loading) {
    return (
      <div style={{ padding: '8px 16px', color: '#666' }}>
        Loading...
      </div>
    );
  }

  if (session?.user) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '12px',
        padding: '8px 16px',
        background: "var(--panel-bg)",
        color: "var(--foreground)",
        borderRadius: '8px',
        border: '1px solid var(--border)',
      }}>
        {session.user.image && (
          <img
            src={session.user.image}
            alt={session.user.name || 'User'}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              objectFit: 'cover'
            }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '12px' }}>Signed in as</span>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>
            {session.user.email || session.user.name}
          </span>
        </div>
        <button
          onClick={() => signOut()}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: "1px solid var(--border)",
            background: "var(--panel-bg)",
            color: "var(--foreground)",
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f5f5f5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fff';
          }}
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("azure-ad", undefined, BASE_LOGIN_AUTHORIZATION_PARAMS)}
      style={{
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: "var(--panel-bg)",
        color: "var(--foreground)",
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 500,
        transition: 'all 0.2s',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      }}
    >
      Sign In
    </button>
  );
}

