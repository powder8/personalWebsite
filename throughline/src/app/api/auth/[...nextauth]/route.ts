/** Auth.js route handlers (sign-in, callback, sign-out, session). */
import { handlers } from '@/auth';

export const runtime = 'nodejs';
export const { GET, POST } = handlers;
