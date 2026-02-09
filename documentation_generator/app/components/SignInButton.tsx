"use client";

import { signIn, signOut, useSession } from 'next-auth/react';

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
        background: 'rgba(0, 0, 0, 0.02)',
        borderRadius: '8px',
        border: '1px solid rgba(0, 0, 0, 0.1)'
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
          <span style={{ fontSize: '12px', color: '#666' }}>Signed in as</span>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
            {session.user.email || session.user.name}
          </span>
        </div>
        <button
          onClick={() => signOut()}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid #ddd',
            background: '#fff',
            color: '#555',
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
      onClick={() => signIn()}
      style={{
        padding: '8px 16px',
        borderRadius: '8px',
        border: 'none',
        background: '#346df1',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 500,
        transition: 'all 0.2s',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#2a5dd9';
        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#346df1';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      }}
    >
      Sign In
    </button>
  );
}

