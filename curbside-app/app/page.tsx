import { redirect } from "next/navigation";

/**
 * There is one page on this site. The root is a redirect to it rather than a
 * second thing to design and keep current.
 */
export default function Home() {
  redirect("/saved");
}
