import { FieldPlayground } from "@/components/field/FieldPlayground";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Field pages playground" };

export default function Page() {
  return <FieldPlayground />;
}
