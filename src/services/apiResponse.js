export async function readApiResponse(response) {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    const message =
      response.status === 504
        ? 'The request took too long. Check whether it completed before trying again.'
        : [502, 503].includes(response.status)
          ? 'The server is temporarily unavailable. Please try again shortly.'
          : 'The server returned an unexpected response. Please try again.';
    throw Object.assign(new Error(message), { status: response.status });
  }
}
