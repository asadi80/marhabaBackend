// app/api/auth/verify-email/route.js - POSTGRESQL VERSION
import { NextResponse } from "next/server";
import pool from "@/lib/postgres";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=invalid-token`
      );
    }

    // Find user with valid token - PostgreSQL version
    const result = await pool.query(
      `SELECT id, role, email_verified FROM users 
       WHERE email_verification_token = $1 
       AND email_verification_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=invalid-expired`
      );
    }

    const user = result.rows[0];

    // If email already verified
    if (user.email_verified) {
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=already-verified`
      );
    }

    // Update user email verification status
    // For regular users, auto-confirm their account
    let newStatus = null;
    if (user.role === "user") {
      newStatus = "confirmed";
    }
    // For hosts, keep as pending until admin approval

    if (newStatus) {
      // Update both email verification and status
      await pool.query(
        `UPDATE users 
         SET email_verified = true, 
             email_verification_token = NULL, 
             email_verification_expires = NULL,
             status = $1
         WHERE id = $2`,
        [newStatus, user.id]
      );
    } else {
      // Update only email verification (for hosts)
      await pool.query(
        `UPDATE users 
         SET email_verified = true, 
             email_verification_token = NULL, 
             email_verification_expires = NULL
         WHERE id = $1`,
        [user.id]
      );
    }

    // Redirect to login page with success message
    const redirectUrl = `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?verified=true&role=${user.role}`;
    return NextResponse.redirect(redirectUrl);
    
  } catch (error) {
    console.error("Email verification error:", error);
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=server-error`
    );
  }
}