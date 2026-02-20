import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { rateLimitAuth } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const limited = rateLimitAuth(request);
  if (limited) return limited;

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

    // Send verification email using NextAuth.js email provider
    try {
      const csrfResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/csrf`);
      const csrfData = await csrfResponse.json();

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

      if (!response.ok) {
        console.error('Verification email failed:', response.status);
      }
    } catch (emailError: unknown) {
      console.error('Verification email error:', (emailError as Error)?.message);
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