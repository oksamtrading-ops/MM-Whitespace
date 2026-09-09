import Refusal from "./_ui/Refusal.tsx";

export default function NotFound() {
  return (
    <Refusal title="Nothing here"
             body="That address does not match a page in Whitespace. The dashboard is the place to start."
             action={{ href: "/dashboard", label: "Go to the dashboard" }} />
  );
}
