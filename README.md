# 🚀 GitLab MR MCP

A Model Context Protocol (MCP) server for interacting with GitLab merge requests, issues, CI/CD pipelines, and code quality reports.

## 📌 Overview

This project implements a server using the Model Context Protocol (MCP) that allows AI agents to interact with GitLab repositories. It provides tools for:

- Listing available GitLab projects
- Fetching merge request details, comments, and diffs
- Adding comments and replying to discussion threads
- Fetching issue details
- Setting merge request title and description
- Inspecting CI/CD pipeline jobs and artifacts
- Retrieving code quality reports and test summaries

## 📦 Installation

### ⚡ Using Smithery

To install GitLab MR MCP for Claude Desktop automatically via Smithery:

```bash
npx -y @smithery/cli@latest install @kopfrechner/gitlab-mr-mcp --client claude --config '"{\"gitlabMrMcpToken\":\"YOUR_GITLAB_TOKEN\", \"gitlabMrMcpHost\": \"YOUR_GITLAB_HOST\"}"'
```

### 🛠️ Manual Installation

#### 🔧 Prerequisites

- Node.js
- GitLab access token with API access
- GitLab project ID(s)

#### 📖 Setup

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "gitlab-mr-mcp": {
      "command": "node",
      "args": ["/path/to/gitlab-mr-mcp/index.js"],
      "env": {
        "MR_MCP_GITLAB_TOKEN": "your_gitlab_token",
        "MR_MCP_GITLAB_HOST": "your_gitlab_host"
      }
    }
  }
}
```

## 🔌 Hermes Agent Configuration

To use this MCP server with [Hermes Agent](https://github.com/nousresearch/hermes-agent), add it to your `config.yaml` under `mcp_servers`:

```yaml
mcp_servers:
  gitlab_mr_mcp:
    command: node
    args:
      - /path/to/gitlab-mr-mcp/index.js
    env:
      MR_MCP_GITLAB_TOKEN: "glpat-your-gitlab-token"
      MR_MCP_GITLAB_HOST: "gitlab.yourcompany.com"
```

After adding the config, restart Hermes or reload tools:

```bash
hermes tools
```

The server will expose 15 tools automatically. Here's an example workflow:

```
# Find open MRs in a project
→ get_projects → list_open_merge_requests(project_id: 42)

# Review an MR with code quality
→ get_merge_request_details(42, 7)
→ get_code_quality_report(42, 7)
→ get_test_report(42, 7)

# Reply to a reviewer comment
→ get_merge_request_comments(42, 7, verbose: true)  # get discussion_id
→ reply_to_merge_request_discussion(42, 7, discussion_id, "Fixed, thanks!")
```

**Environment variables for filtering:**

```yaml
    env:
      MR_MCP_GITLAB_TOKEN: "glpat-your-token"
      MR_MCP_GITLAB_HOST: "gitlab.yourcompany.com"
      MR_MCP_MIN_ACCESS_LEVEL: "30"        # optional: filter by access level
      MR_MCP_PROJECT_SEARCH_TERM: "my-"    # optional: filter projects by name
```

## 🛠️ Available Tools

### Projects & Merge Requests

- `get_projects`
  Gets a list of GitLab projects accessible with your token.

- `list_open_merge_requests`
  Lists all open merge requests in the specified project.

- `get_merge_request_details`
  Gets detailed information about a specific merge request (title, branches, URL, pipeline status).

- `get_merge_request_comments`
  Gets comments from a specific merge request, including discussion notes and diff notes. Returns `discussion_id` for each comment, usable with `reply_to_merge_request_discussion`.

- `get_merge_request_diff`
  Gets the file diffs for a merge request.

### Comments & Discussions

- `add_merge_request_comment`
  Adds a general comment to a merge request.

- `reply_to_merge_request_discussion`
  Replies to an existing discussion thread on a merge request. Use this to answer reviewer/bot comments in their specific thread. The `discussion_id` is obtained from `get_merge_request_comments` (verbose=true).

- `add_merge_request_diff_comment`
  Adds a comment to a specific line in a file within a merge request diff.

### Merge Request Metadata

- `set_merge_request_title`
  Sets the title of a merge request.

- `set_merge_request_description`
  Sets the description of a merge request.

### Issues

- `get_issue_details`
  Gets detailed information about a specific issue.

### CI/CD Pipelines & Jobs

- `get_pipeline_jobs`
  Gets the CI/CD jobs for a specific pipeline. Useful for finding jobs that produce reports (e.g., golangci-lint, code-quality).

- `get_job_details`
  Gets details of a specific CI/CD job including its artifacts. Look for artifacts with `file_type: "codequality"` or `file_type: "junit"`.

### Code Quality & Test Reports

- `get_code_quality_report`
  Gets the Code Quality report for a merge request. Finds the latest pipeline, locates the job with a codequality artifact, and returns a structured summary grouped by severity, check type, and file.

- `get_test_report`
  Gets the test summary report for a merge request. Finds the latest pipeline, locates the job with junit test artifacts, downloads the junit-report.xml, and returns a structured summary: total tests, failures, errors, skipped, time, and details of each failure with stack trace.

## 🏗️ Development

### 🔍 Running Inspector

Set up environment variables:

```bash
export MR_MCP_GITLAB_TOKEN=your_gitlab_token
export MR_MCP_GITLAB_HOST=your_gitlab_host

# Optional env vars to filter the projects the `get_projects` tool has access to:
# https://docs.gitlab.com/api/access_requests/#valid-access-levels
export MR_MCP_MIN_ACCESS_LEVEL=min_access_level
# Search term that should match the project path or name 
export MR_MCP_PROJECT_SEARCH_TERM=term 
```

For use with MCP clients, you can run:

```bash
npx -y @modelcontextprotocol/inspector npm start
```

## 🛠️ Troubleshooting

If you encounter permissions issues (403 Forbidden), check:

1. Your GitLab token has the proper scopes (`api`, `read_api`)
2. The token user has proper access to the projects
3. The project IDs are correct

For `get_code_quality_report` or `get_test_report` returning no data:

1. Make sure the MR has a completed pipeline
2. Check that the pipeline has a job with `codequality` or `junit` artifacts
3. Use `get_pipeline_jobs` → `get_job_details` to inspect available artifacts manually

## 📜 License

[MIT](LICENSE)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
