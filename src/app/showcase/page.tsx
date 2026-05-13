import type { Metadata } from "next";
import AppDemo from "@/components/showcase/AppDemo";

export const metadata: Metadata = {
  title: "W-MPTRS — Smart Route Finder",
  description: "Weather-Aware Multimodal Public Transportation Routing System · Jakarta",
};

export default function ShowcasePage() {
  return <AppDemo />;
}
