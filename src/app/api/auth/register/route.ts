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

    // Send magic link automatically during registration
    try {
      // Trigger NextAuth.js email provider to send magic link
      const response = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/signin/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: email,
          callbackUrl: `${process.env.NEXTAUTH_URL}/overview`,
        }),
      });

      if (response.ok) {
        console.log('Magic link sent successfully to:', email);
      } else {
        console.error('Failed to send magic link, status:', response.status);
      }
    } catch (emailError) {
      console.error('Failed to send magic link:', emailError);
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