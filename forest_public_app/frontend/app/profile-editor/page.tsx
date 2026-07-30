import { redirect } from "next/navigation";

/**
 * Keep the original canvas editor and its realistic tree layers intact.
 * This route remains for existing bookmarks.
 */
export default function ProfileEditorPage() {
  redirect("/profile-editor/index.html");
}
