// src/auth.config.ts

import type { NextAuthConfig } from 'next-auth';

declare module 'next-auth' {

  interface User {
    role?: string;
  }

  interface Session {
    user: {
      role: string;
    } & {
      id: string;
    };
  }
}

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    // This callback adds the role to the JWT
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    // This callback adds the role to the session, making it available in the client
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');

      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login page
      } else if (isLoggedIn) {
        // Redirect logged-in users from /login to /dashboard
        if (nextUrl.pathname === '/login') {
            return Response.redirect(new URL('/dashboard', nextUrl));
        }
      }
      return true;
    },
  },
  providers: [],
} satisfies NextAuthConfig;