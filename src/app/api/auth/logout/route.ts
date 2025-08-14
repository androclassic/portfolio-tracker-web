import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export async function POST() {
  try {
    // Create a simple JSON response
    const res = NextResponse.json({ success: true, message: 'Logged out successfully' });
    
    // Clear the authentication cookie
    clearAuthCookie(res);
    
    return res;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ success: false, error: 'Logout failed' }, { status: 500 });
  }
}


