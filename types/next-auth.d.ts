/**
 * Auth.js v5 module augmentation: extender Session y JWT con campos
 * propios (role, uid) sin romper el tipado built-in.
 *
 * Por qué existe: `next-auth` define `Session.user.email`/`name`/`image`
 * pero no sabe de nuestros campos custom. Sin este archivo, los accesos
 * a `session.user.role` tirarían TS error "property does not exist".
 */
import type { AppRole } from "@/lib/auth";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      role?: AppRole;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }

  interface User {
    role?: AppRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    uid?: string;
  }
}
