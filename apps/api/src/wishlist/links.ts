/** The share page (spec §2). Its token is the capability: anyone holding the link may look. */
export function shareUrl(appOrigin: string, shareToken: string): string {
  return `${appOrigin}/s/${shareToken}`;
}

/** A claim's manage page (spec §5), built here beside the share link so both come from one place. */
export function manageUrl(appOrigin: string, manageToken: string): string {
  return `${appOrigin}/c/${manageToken}`;
}
