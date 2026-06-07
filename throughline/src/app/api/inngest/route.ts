import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { functions } from '@/inngest/functions';

/** Inngest's HTTP entrypoint — registers and runs background functions. */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
