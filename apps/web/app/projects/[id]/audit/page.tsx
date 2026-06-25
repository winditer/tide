"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight, GitCommit } from "lucide-react";
import { GitAuditPage } from "@tide/views";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AuditPage({ params }: PageProps) {
  const { id: projectId } = use(params);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
        <Link
          href="/projects"
          className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          项目
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          href={`/projects/${projectId}`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          项目详情
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="flex items-center gap-1 text-zinc-900 dark:text-zinc-100 font-medium">
          <GitCommit className="h-3.5 w-3.5" />
          Git 审计
        </span>
      </nav>

      {/* Main content */}
      <GitAuditPage projectId={projectId} />
    </div>
  );
}
