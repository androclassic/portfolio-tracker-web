import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    console.log('Setup password session:', session);
    
    if (!session?.user?.email) {
      console.log('No session or email found:', { session: !!session, email: session?.user?.email });
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { password } = await request.json();

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    // Find the user
    console.log('Looking for user with email:', session.user.email);
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      console.log('User not found for email:', session.user.email);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    console.log('User found:', { id: user.id, email: user.email, hasPassword: !!user.passwordHash });

    // Check if user already has a password
    if (user.passwordHash) {
      console.log('User already has password hash');
      return NextResponse.json(
        { error: 'User already has a password set' },
        { status: 400 }
      );
    }

    // Hash the password
    console.log('Hashing password...');
    const passwordHash = await bcrypt.hash(password, 12);

    // Update the user with the password hash
    console.log('Updating user with password hash...');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    console.log('Password set successfully for user:', user.email);
    return NextResponse.json({
      message: 'Password set successfully'
    });

  } catch (error) {
    console.error('Setup password error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
