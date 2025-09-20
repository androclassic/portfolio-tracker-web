import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user (email not verified initially)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        emailVerified: null, // Email not verified initially
      }
    });

    // Send verification email using NextAuth.js email provider (same as resend verification)
    console.log('=== STARTING EMAIL SEND PROCESS ===');
    console.log('Target email:', email);
    try {
      // Trigger NextAuth.js email provider from server-side (same as resend verification)
      console.log('Calling NextAuth.js email provider endpoint...');
      
      // Get CSRF token first
      const csrfResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/csrf`);
      const csrfData = await csrfResponse.json();
      
      // Call NextAuth.js email signin endpoint (same as resend verification)
      const response = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/signin/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: email,
          callbackUrl: `${process.env.NEXTAUTH_URL}/overview`,
          csrfToken: csrfData.csrfToken,
        }),
      });

      if (response.ok) {
        console.log('NextAuth.js email provider call successful');
        console.log('Verification email sent successfully to:', email);
      } else {
        const errorText = await response.text();
        console.error('NextAuth.js email provider failed:', response.status, errorText);
        throw new Error(`NextAuth.js email provider failed: ${response.status} ${errorText}`);
      }
    } catch (emailError: unknown) {
      console.error('=== EMAIL SENDING FAILED ===');
      const error = emailError as Error & { code?: string };
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error?.message);
      console.error('Error code:', error?.code);
      console.error('Full error:', emailError);
      console.error('=== END EMAIL ERROR ===');
      // Don't fail the registration if email sending fails
    }

    return NextResponse.json({
      message: 'Account created successfully! Please check your email for a verification link to complete your registration.',
      user: {
        id: user.id,
        email: user.email,
      },
      requiresVerification: true
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}