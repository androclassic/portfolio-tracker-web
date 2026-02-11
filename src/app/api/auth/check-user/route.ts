import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        passwordHash: true,
      }
    });

    if (!user) {
      return NextResponse.json(
        { exists: false, message: 'No account found with this email address' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      exists: true,
      user: {
        email: user.email,
        emailVerified: !!user.emailVerified,
        hasPassword: !!user.passwordHash,
      }
    });

  } catch (error) {
    console.error('Check user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
