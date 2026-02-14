import { NextAuthOptions, getServerSession } from "next-auth"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import GoogleProvider from "next-auth/providers/google"
import EmailProvider from "next-auth/providers/email"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { hashApiKey } from "@/lib/api-key"
import { NextRequest } from "next/server"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  callbacks: {
    async signIn({ user, account, profile, email, credentials }) {
      // For credentials provider, check if email is verified
      if (account?.provider === "credentials") {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! }
        });
        
        if (!dbUser?.emailVerified) {
          throw new Error("Please verify your email before signing in");
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
        
        // Check if user needs to set up password (logged in via email but has no password hash)
        if (account?.provider === "email") {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email! }
          });
          
          token.needsPasswordSetup = !dbUser?.passwordHash;
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        
        // Re-check if user still needs password setup (in case they just set it)
        if (token.needsPasswordSetup) {
          const dbUser = await prisma.user.findUnique({
            where: { email: session.user.email! }
          });
          session.needsPasswordSetup = !dbUser?.passwordHash;
        } else {
          session.needsPasswordSetup = token.needsPasswordSetup as boolean
        }
      }
      return session
    }
  },
  providers: [
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT) || 587,
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          }
        })

        if (!user || !user.passwordHash) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  useSecureCookies: true,
  debug: true,
  pages: {
    signIn: "/login",
  }
}

// Helper function to get session in API routes.
// Supports both NextAuth session cookies AND API key authentication (X-API-Key header).
// API key auth enables external integrations (MCP servers, CardanoTicker, etc.)
// to access all endpoints without a browser session.
export async function getServerAuth(req: NextRequest) {
  // First try NextAuth session
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return {
      userId: session.user.id,
      user: session.user
    };
  }

  // Fallback: check for API key in header
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) {
    const hashedKey = hashApiKey(apiKey);
    const keyRecord = await prisma.apiKey.findFirst({
      where: {
        key: hashedKey,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true, userId: true },
    });

    if (keyRecord) {
      // Update last used (fire and forget)
      prisma.apiKey.update({
        where: { id: keyRecord.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {});

      // Fetch user to match session user type
      const user = await prisma.user.findUnique({
        where: { id: keyRecord.userId },
        select: { id: true, name: true, email: true, image: true }
      });

      if (!user) {
        return null;
      }

      return {
        userId: keyRecord.userId,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        }
      };
    }
  }

  return null;
}