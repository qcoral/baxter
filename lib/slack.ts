export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    display_name: string;
    real_name: string;
    email: string;
    image_48: string;
    image_72: string;
    image_192: string;
  };
}

const cache = new Map<string, SlackUser | null>();

export async function lookupSlackUserByEmail(email: string): Promise<SlackUser | null> {
  if (cache.has(email)) return cache.get(email)!;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      cache.set(email, null);
      return null;
    }
    const data = await res.json();
    const user = data.ok ? (data.user as SlackUser) : null;
    cache.set(email, user);
    return user;
  } catch {
    cache.set(email, null);
    return null;
  }
}
