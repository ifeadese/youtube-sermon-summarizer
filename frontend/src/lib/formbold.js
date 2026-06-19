/**
 * FormBold submission utility.
 * Posts JSON data to a FormBold endpoint and normalises the response.
 * Ported from onehub/lib/formbold.ts.
 */

export const DEFAULT_FORMBOLD_SUBMIT_URL = "https://formbold.com/s/3GLXp";

async function readResponseMessage(response) {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return data.error ?? data.message ?? data.errors?.[0]?.message ?? null;
    }

    const text = await response.text();
    return text.trim() ? text.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * Submit data to a FormBold endpoint via JSON POST.
 * @param {Record<string, unknown>} data - The form payload.
 * @param {{ endpoint: string }} options
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function submitToFormBold(data, options) {
  const endpoint = options.endpoint.trim();

  if (!endpoint) {
    return {
      success: false,
      error: "Form submission endpoint is not configured.",
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      return { success: true };
    }

    const message = await readResponseMessage(response);

    return {
      success: false,
      error: message ?? `Form submission failed (${response.status}).`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}
