import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Gitlab } from "@gitbeaker/rest";
import { exec } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import _ from "lodash";


// Promisify exec for async usage
const execAsync = promisify(exec);

// Initialize GitLab API Client
const gitlabToken = process.env.MR_MCP_GITLAB_TOKEN;
if (!gitlabToken) {
  console.error("Error: MR_MCP_GITLAB_TOKEN environment variable is not set.");
}

const api = new Gitlab({
  host: `https://${process.env.MR_MCP_GITLAB_HOST}`,
  token: gitlabToken,
});


// Helper function to format errors for MCP responses
const formatErrorResponse = (error) => ({
  content: [{ type: "text", text: `Error: ${error.message} - ${error.cause?.description || "No additional details"}` }],
  isError: true,
});

// Initialize the MCP server
const server = new McpServer({
  name: "GitlabMrMCP",
  version: "1.0.0",
});

// --- Merge Request Tools ---
server.tool(
  "get_projects",
  "Get a list of projects with id, name, description, web_url and other useful information.",
  {
    verbose: z.boolean().describe("By default a filtered version is returned, suitable for most cases. Only set true if more information is needed.").default(false),
  },
  async ({ verbose }) => {
    try {
      const projectFilter = {
        ...(process.env.MR_MCP_MIN_ACCESS_LEVEL ? { minAccessLevel: parseInt(process.env.MR_MCP_MIN_ACCESS_LEVEL, 10) } : {}),
        ...(process.env.MR_MCP_PROJECT_SEARCH_TERM ? { search: process.env.MR_MCP_PROJECT_SEARCH_TERM } : {}),
      }
      const projects = await api.Projects.all({ membership: true, ...projectFilter });
      const filteredProjects = verbose ? projects : projects.map(project => ({
        id: project.id,
        description: project.description,
        name: project.name,
        path: project.path,
        path_with_namespace: project.path_with_namespace,
        web_url: project.web_url, 
        default_branch: project.default_branch,
      }));

      const projectsText = Array.isArray(filteredProjects) && filteredProjects.length > 0
        ? JSON.stringify(filteredProjects, null, 2)
        : "No projects found.";
      return {
        content: [{ type: "text", text: projectsText }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "list_open_merge_requests",
  "Lists all open merge requests in the project",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    verbose: z.boolean().describe("By default a filtered version is returned, suitable for most cases. Only set true if more information is needed.").default(false),
  },
  async ({ verbose, project_id }) => {
    try {
      const mergeRequests = await api.MergeRequests.all({ projectId: project_id, state: 'opened' });

      const filteredMergeRequests = verbose ? mergeRequests : mergeRequests.map(mr => ({
        iid: mr.iid,
        project_id: mr.project_id,
        title: mr.title,
        description: mr.description,
        state: mr.state,
        web_url: mr.web_url,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(filteredMergeRequests, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_merge_request_details",
  "Get details about a specific merge request of a project like title, source-branch, target-branch, web_url, ...",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    verbose: z.boolean().describe("By default a filtered version is returned, suitable for most cases. Only set true if more information is needed.").default(false),
  },
  async ({ project_id, merge_request_iid, verbose }) => {
    try {
      const mr = await api.MergeRequests.show(project_id, merge_request_iid);
      const filteredMr = verbose ? mr : {
        title: mr.title,
        description: mr.description,
        state: mr.state,
        web_url: mr.web_url,
        target_branch: mr.target_branch,
        source_branch: mr.source_branch,
        merge_status: mr.merge_status,
        detailed_merge_status: mr.detailed_merge_status,
        diff_refs: mr.diff_refs,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(filteredMr, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_merge_request_comments",
  "Get general and file diff comments of a certain merge request",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    verbose: z.boolean().describe("By default a filtered version is returned, suitable for most cases. Only set true if more information is needed.").default(false),
  },
  async ({ project_id, merge_request_iid, verbose }) => {
    try {
      const discussions = await api.MergeRequestDiscussions.all(project_id, merge_request_iid);
      
      if (verbose) {
        return {
          content: [{ type: "text", text: JSON.stringify(discussions, null, 2) }],
        };
      }
      
      const unresolvedNotes = discussions.flatMap(note => note.notes).filter(note => note.resolved === false);
      const disscussionNotes = unresolvedNotes.filter(note => note.type === "DiscussionNote").map(note => {
        const disc = discussions.find(d => d.notes.some(n => n.id === note.id));
        return {
          id: note.id,
          noteable_id: note.noteable_id,
          body: note.body,
          author_name: note.author.name,
          discussion_id: disc ? disc.id : null,
        };
      });
      const diffNotes = unresolvedNotes.filter(note => note.type === "DiffNote").map(note => {
        const disc = discussions.find(d => d.notes.some(n => n.id === note.id));
        return {
          id: note.id,
          noteable_id: note.noteable_id,
          body: note.body,
          author_name: note.author.name,
          position: note.position,
          discussion_id: disc ? disc.id : null,
        };
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ 
          disscussionNotes,
          diffNotes
        }, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "add_merge_request_comment",
  "Add a general comment to a merge request",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    comment: z.string().describe("The comment text"),
  },
  async ({ project_id, merge_request_iid, comment }) => {
    try {
      const note = await api.MergeRequestDiscussions.create(project_id, merge_request_iid, comment);
      return {
        content: [{ type: "text", text: JSON.stringify(note, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "reply_to_merge_request_discussion",
  "Reply to an existing discussion thread on a merge request. Use this to answer reviewer/bot comments in their specific discussion thread, NOT to create a new standalone comment. The discussion_id can be obtained from get_merge_request_comments (verbose=true) which returns the full discussion objects with their 'id' field.",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    discussion_id: z.string().describe("The discussion ID to reply to (from get_merge_request_comments verbose=true, the 'id' field of the discussion object)"),
    comment: z.string().describe("The reply comment text"),
  },
  async ({ project_id, merge_request_iid, discussion_id, comment }) => {
    try {
      const note = await api.MergeRequestDiscussions.addNote(
        project_id,
        merge_request_iid,
        discussion_id,
        comment
      );
      return {
        content: [{ type: "text", text: JSON.stringify(note, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "add_merge_request_diff_comment",
  "Add a comment of a merge request at a specific line in a file diff",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    comment: z.string().describe("The comment text"),
    base_sha: z.string().describe("The SHA of the base commit"),
    start_sha: z.string().describe("The SHA of the start commit"),
    head_sha: z.string().describe("The SHA of the head commit"),
    file_path: z.string().describe("The path to the file being commented on"),
    line_number: z.string().describe("The line number in the new version of the file"),
  },
  async ({ project_id, merge_request_iid, comment, base_sha, start_sha, head_sha, file_path, line_number }) => {
    try {
      const discussion = await api.MergeRequestDiscussions.create(
        project_id, 
        merge_request_iid, 
        comment,
        {
          position: {
            base_sha: base_sha,
            start_sha: start_sha,
            head_sha: head_sha,
            old_path: file_path,
            new_path: file_path,
            position_type: 'text',
            new_line: line_number,
          },
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(discussion, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_merge_request_diff",
  "Get the file diffs of a certain merge request",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
  },
  async ({ project_id, merge_request_iid }) => {
    try {
      const diff = await api.MergeRequests.allDiffs(project_id, merge_request_iid);
      const diffText = Array.isArray(diff) && diff.length > 0
        ? JSON.stringify(diff, null, 2)
        : "No diff data available for this merge request.";
      return {
        content: [{ type: "text", text: diffText }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_pipeline_jobs",
  "Get the CI/CD jobs for a specific pipeline. Useful for finding jobs that produce reports (e.g., golangci-lint, code-quality).",
  {
    project_id: z.number().describe("The project ID"),
    pipeline_id: z.number().describe("The pipeline ID (from MR details head_pipeline.id)"),
  },
  async ({ project_id, pipeline_id }) => {
    try {
      const jobs = await api.Jobs.all(project_id, { pipelineId: pipeline_id });
      const filteredJobs = jobs.map(job => ({
        id: job.id,
        name: job.name,
        status: job.status,
        stage: job.stage,
        allow_failure: job.allow_failure,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(filteredJobs, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_job_details",
  "Get details of a specific CI/CD job including its artifacts. Use this to find jobs that have codequality reports. Look for artifacts with file_type 'codequality'.",
  {
    project_id: z.number().describe("The project ID"),
    job_id: z.number().describe("The job ID (from get_pipeline_jobs)"),
  },
  async ({ project_id, job_id }) => {
    try {
      const job = await api.Jobs.show(project_id, job_id);
      const filteredJob = {
        id: job.id,
        name: job.name,
        status: job.status,
        stage: job.stage,
        pipeline_id: job.pipeline_id,
        artifacts: job.artifacts,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(filteredJob, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_code_quality_report",
  "Get the Code Quality report for a merge request. This finds the latest pipeline for the MR, locates the job with a codequality artifact, and returns the report as a structured summary grouped by severity, check type, and file.",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
  },
  async ({ project_id, merge_request_iid }) => {
    try {
      // Step 1: Get MR details to find the head pipeline
      const mr = await api.MergeRequests.show(project_id, merge_request_iid);
      const pipelineId = mr.head_pipeline?.id;
      if (!pipelineId) {
        return {
          content: [{ type: "text", text: "No pipeline found for this merge request." }],
        };
      }

      // Step 2: Get all jobs for the pipeline
      const jobs = await api.Jobs.all(project_id, { pipelineId });
      
      // Step 3: Find jobs with codequality artifacts
      let codeQualityJob = null;
      for (const job of jobs) {
        const jobDetails = await api.Jobs.show(project_id, job.id);
        if (jobDetails.artifacts && Array.isArray(jobDetails.artifacts)) {
          const hasCodeQuality = jobDetails.artifacts.some(
            a => a.file_type === 'codequality'
          );
          if (hasCodeQuality) {
            codeQualityJob = job;
            break;
          }
        }
      }

      if (!codeQualityJob) {
        // List available jobs for debugging
        const jobList = jobs.map(j => `${j.name} (${j.status})`).join(', ');
        return {
          content: [{ type: "text", text: `No job with codequality artifact found in pipeline ${pipelineId}. Available jobs: ${jobList}` }],
        };
      }

      // Step 4: Download the code quality report
      const report = await api.JobArtifacts.downloadArchive(project_id, {
        jobId: codeQualityJob.id,
        artifactPath: 'gl-code-quality-report.json',
      });

      // Step 5: Parse and summarize the report
      let issues = [];
      try {
        // The response might be a Buffer or a string
        const reportText = typeof report === 'string' ? report : report.toString();
        issues = JSON.parse(reportText);
      } catch (parseError) {
        return {
          content: [{ type: "text", text: `Failed to parse code quality report: ${parseError.message}` }],
        };
      }

      // Group by severity
      const bySeverity = {};
      const byCheck = {};
      const byFile = {};

      for (const item of issues) {
        const sev = item.severity;
        const check = item.check_name;
        const path = item.location?.path || 'unknown';

        bySeverity[sev] = (bySeverity[sev] || 0) + 1;
        byCheck[check] = (byCheck[check] || 0) + 1;
        byFile[path] = (byFile[path] || 0) + 1;
      }

      // Build summary
      let summary = `Code Quality Report for MR !${merge_request_iid}\n`;
      summary += `Pipeline: ${pipelineId}, Job: ${codeQualityJob.name}\n`;
      summary += `Total issues: ${issues.length}\n\n`;

      summary += `=== By severity ===\n`;
      for (const sev of ['blocker', 'critical', 'major', 'minor', 'info']) {
        if (bySeverity[sev]) {
          summary += `  ${sev}: ${bySeverity[sev]}\n`;
        }
      }

      summary += `\n=== By check type ===\n`;
      const sortedChecks = Object.entries(byCheck).sort((a, b) => b[1] - a[1]);
      for (const [check, count] of sortedChecks) {
        summary += `  ${check}: ${count}\n`;
      }

      summary += `\n=== By file (top 15) ===\n`;
      const sortedFiles = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 15);
      for (const [file, count] of sortedFiles) {
        summary += `  ${file}: ${count}\n`;
      }

      // Return full report as well
      summary += `\n=== Full report (JSON) ===\n`;
      summary += JSON.stringify(issues, null, 2);

      return {
        content: [{ type: "text", text: summary }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "get_test_report",
  "Get the test summary report for a merge request. Finds the latest pipeline, locates the job with junit test artifacts, downloads the junit-report.xml, and returns a structured summary: total tests, failures, errors, skipped, time, and details of each failure with stack trace.",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
  },
  async ({ project_id, merge_request_iid }) => {
    try {
      // Step 1: Get MR details to find the head pipeline
      const mr = await api.MergeRequests.show(project_id, merge_request_iid);
      const pipelineId = mr.head_pipeline?.id;
      if (!pipelineId) {
        return {
          content: [{ type: "text", text: "No pipeline found for this merge request." }],
        };
      }

      // Step 2: Get all jobs for the pipeline
      const jobs = await api.Jobs.all(project_id, { pipelineId });

      // Step 3: Find job with junit artifacts
      let testJob = null;
      for (const job of jobs) {
        const jobDetails = await api.Jobs.show(project_id, job.id);
        if (jobDetails.artifacts && Array.isArray(jobDetails.artifacts)) {
          const hasJunit = jobDetails.artifacts.some(
            a => a.file_type === 'junit'
          );
          if (hasJunit) {
            testJob = job;
            break;
          }
        }
      }

      if (!testJob) {
        const jobList = jobs.map(j => `${j.name} (${j.status})`).join(', ');
        return {
          content: [{ type: "text", text: `No job with junit test artifact found in pipeline ${pipelineId}. Available jobs: ${jobList}` }],
        };
      }

      // Step 4: Download the full artifacts archive
      const archiveBuffer = await api.JobArtifacts.downloadArchive(project_id, {
        jobId: testJob.id,
      });

      // Step 5: Extract and parse junit-report.xml from the zip
      const zlib = await import('zlib');
      const zipContent = Buffer.isBuffer(archiveBuffer) ? archiveBuffer : Buffer.from(archiveBuffer);

      // Simple zip parser — find junit-report.xml entry and decompress
      const xmlContent = extractZipEntry(zipContent, 'junit-report.xml');
      if (!xmlContent) {
        // List entries for debugging
        const entries = listZipEntries(zipContent);
        return {
          content: [{ type: "text", text: `Could not find junit-report.xml in artifacts archive. Available entries: ${entries.join(', ')}` }],
        };
      }

      // Step 6: Parse XML
      const summary = parseJunitXml(xmlContent);

      // Build output
      let output = `Test Report for MR !${merge_request_iid}\n`;
      output += `Pipeline: ${pipelineId}, Job: ${testJob.name} (${testJob.status})\n`;
      output += `Total: tests=${summary.tests}, failures=${summary.failures}, errors=${summary.errors}, skipped=${summary.skipped}, time=${summary.time}s\n\n`;

      if (summary.failures > 0 || summary.errors > 0) {
        output += `=== Failed tests (${summary.failures + summary.errors}) ===\n\n`;
        for (const fail of summary.failures_details) {
          output += `FAIL: ${fail.package}.${fail.test}\n`;
          output += `  Message: ${fail.message}\n`;
          const lines = (fail.stack || '').split('\n').filter(l => l.trim()).slice(0, 10);
          for (const line of lines) {
            output += `  ${line}\n`;
          }
          output += `\n`;
        }
      }

      output += `=== Packages with failures ===\n`;
      for (const [name, stats] of summary.failed_packages) {
        output += `  ${name}: tests=${stats.tests}, failures=${stats.failures}, errors=${stats.errors}, skipped=${stats.skipped}\n`;
      }

      output += `\n=== All packages (${summary.total_packages}) ===\n`;
      for (const [name, stats] of summary.all_packages) {
        const marker = (stats.failures > 0 || stats.errors > 0) ? ' ❌' : stats.skipped > 0 ? ' ⏭' : ' ✓';
        output += `  ${marker} ${name}: ${stats.tests} tests, ${stats.time}s\n`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

// --- Helper functions for zip parsing and junit XML ---

function extractZipEntry(zipBuffer, entryName) {
  // Minimal ZIP parser to extract a specific entry
  let offset = 0;
  const sigLocal = 0x04034b50; // PK\x03\x04

  while (offset < zipBuffer.length - 4) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== sigLocal) {
      offset++;
      continue;
    }

    const version = zipBuffer.readUInt16LE(offset + 4);
    const flags = zipBuffer.readUInt16LE(offset + 6);
    const method = zipBuffer.readUInt16LE(offset + 8);
    const nameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const compSize = zipBuffer.readUInt32LE(offset + 30);
    const uncompSize = zipBuffer.readUInt32LE(offset + 34);

    const name = zipBuffer.toString('utf8', offset + 30 + 4, offset + 30 + 4 + nameLen);

    if (name === entryName) {
      const dataOffset = offset + 30 + 4 + nameLen + extraLen;
      const compressedData = zipBuffer.slice(dataOffset, dataOffset + compSize);

      if (method === 0) {
        // Stored (no compression)
        return compressedData.toString('utf8');
      } else if (method === 8) {
        // Deflate
        try {
          const decompressed = zlib.inflateSync(compressedData);
          return decompressed.toString('utf8');
        } catch (e) {
          return null;
        }
      }
      return null;
    }

    offset += 30 + 4 + nameLen + extraLen + compSize;
  }

  return null;
}

function listZipEntries(zipBuffer) {
  const entries = [];
  let offset = 0;
  const sigLocal = 0x04034b50;

  while (offset < zipBuffer.length - 4) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== sigLocal) {
      offset++;
      continue;
    }
    const nameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const compSize = zipBuffer.readUInt32LE(offset + 30);
    const name = zipBuffer.toString('utf8', offset + 30 + 4, offset + 30 + 4 + nameLen);
    entries.push(name);
    offset += 30 + 4 + nameLen + extraLen + compSize;
  }

  return entries;
}

function parseJunitXml(xmlContent) {
  const result = {
    tests: 0, failures: 0, errors: 0, skipped: 0, time: 0,
    failures_details: [],
    failed_packages: [],
    all_packages: [],
    total_packages: 0,
  };

  // Parse root <testsuites> attributes
  const rootMatch = xmlContent.match(/<testsuites[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"[^>]*time="([^"]*)"/);
  if (rootMatch) {
    result.tests = parseInt(rootMatch[1]);
    result.failures = parseInt(rootMatch[2]);
    result.errors = parseInt(rootMatch[3]);
    result.time = parseFloat(rootMatch[4]);
  }
  const skippedMatch = xmlContent.match(/<testsuites[^>]*skipped="(\d+)"/);
  if (skippedMatch) {
    result.skipped = parseInt(skippedMatch[1]);
  }

  // Parse individual <failure> tags
  const failureRegex = /<failure\s+message="([^"]*)"[^>]*>(.*?)<\/failure>/gs;
  let failureMatch;
  while ((failureMatch = failureRegex.exec(xmlContent)) !== null) {
    const message = decodeXml(failureMatch[1]);
    const stackRaw = decodeXml(failureMatch[2]);

    // Find the parent testsuite name and testcase name
    const beforeFailure = xmlContent.substring(0, failureMatch.index);
    const lastTestsuite = beforeFailure.lastIndexOf('<testsuite');
    const nameMatch = beforeFailure.substring(lastTestsuite).match(/name="([^"]*)"/);
    const packageName = nameMatch ? decodeXml(nameMatch[1]) : 'unknown';

    // Find testcase name
    const lastTestcase = beforeFailure.lastIndexOf('<testcase');
    const tNameMatch = beforeFailure.substring(lastTestcase).match(/name="([^"]*)"/);
    const testName = tNameMatch ? decodeXml(tNameMatch[1]) : 'unknown';

    result.failures_details.push({
      package: packageName,
      test: testName,
      message,
      stack: stackRaw.trim(),
    });
  }

  // Parse testsuites for package summary
  const suiteRegex = /<testsuite\s+tests="(\d+)"\s+failures="(\d+)"[^>]*time="([^"]*)"\s+name="([^"]*)"/gs;
  let suiteMatch;
  while ((suiteMatch = suiteRegex.exec(xmlContent)) !== null) {
    const tests = parseInt(suiteMatch[1]);
    const failures = parseInt(suiteMatch[2]);
    const time = parseFloat(suiteMatch[3]);
    const name = decodeXml(suiteMatch[4]);

    // Check for errors and skipped in this suite
    const suiteBlock = xmlContent.substring(suiteMatch.index, suiteRegex.lastIndex);
    const errMatch = suiteBlock.match(/errors="(\d+)"/);
    const skipMatch = suiteBlock.match(/skipped="(\d+)"/);
    const errors = errMatch ? parseInt(errMatch[1]) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;

    const stats = { tests, failures, errors, skipped, time };
    result.all_packages.push([name, stats]);
    result.total_packages++;

    if (failures > 0 || errors > 0) {
      result.failed_packages.push([name, stats]);
    }
  }

  // Sort: failed first, then by test count
  result.all_packages.sort((a, b) => {
    const aFailed = a[1].failures + a[1].errors;
    const bFailed = b[1].failures + b[1].errors;
    if (aFailed !== bFailed) return bFailed - aFailed;
    return b[1].tests - a[1].tests;
  });

  return result;
}

function decodeXml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#xA;/g, '\n')
    .replace(/&#xD;/g, '\r')
    .replace(/&apos;/g, "'");
}

server.tool(
  "get_issue_details",
  "Get details of an issue within a certain project",
  {
    project_id: z.number().describe("The project ID of the issue"),
    issue_iid: z.number().describe("The internal ID of the issue within the project"),
    verbose: z.boolean().describe("By default a filtered version is returned, suitable for most cases. Only set true if more information is needed.").default(false),
  },
  async ({ project_id, issue_iid, verbose }) => {
    try {
      const issue = await api.Issues.show(issue_iid, { projectId: project_id });

      const filteredIssue = verbose ? issue : {
        title: issue.title,
        description: issue.description,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(filteredIssue, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "set_merge_request_description",
  "Set the description of a merge request",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    description: z.string().describe("The description text"),
  },
  async ({ project_id, merge_request_iid, description }) => {
    try {
      const mr = await api.MergeRequests.edit( project_id, merge_request_iid, { description });
      return {
        content: [{ type: "text", text: JSON.stringify(mr, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);

server.tool(
  "set_merge_request_title",
  "Set the title of a merge request",
  {
    project_id: z.number().describe("The project ID of the merge request"),
    merge_request_iid: z.number().describe("The internal ID of the merge request within the project"),
    title: z.string().describe("The title of the merge request"),
  },
  async ({ project_id, merge_request_iid, title }) => {
    try {
      const mr = await api.MergeRequests.edit( project_id, merge_request_iid, { title });
      return {
        content: [{ type: "text", text: JSON.stringify(mr, null, 2) }],
      };
    } catch (error) {
      return formatErrorResponse(error);
    }
  }
);


// Connect the server to a transport and start it
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

// Only run the server if this file is the main module
const isMainModule = process.argv[1] === new URL(import.meta.url).pathname;
if (isMainModule) {
  runServer();
}

export { server, api };