import type { ReactNode } from "react";

export function Padding({
  className = "mx-2",
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <div className={`${className} duration-300`}>{children}</div>;
}
