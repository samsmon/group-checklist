'use strict';

// All modal/popup/toast HTML — injected into #modals-mount during alpine:init
// so Alpine processes the directives as part of the main DOM scan.
const _modalHTML = `

  <!-- Guest name -->
  <div class="modal-backdrop" x-show="modal === 'guestName'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-1">
      <h3 id="modal-title-1">Your display name</h3>
      <div class="modal-body">
        <div class="form-group">
          <label>Name (used for all actions)</label>
          <input type="text" x-model="guestNameInput" maxlength="100" @keyup.enter="saveGuestName()" placeholder="Your name" />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="saveGuestName()">Save</button>
      </div>
    </div>
  </div>

  <!-- Create checklist -->
  <div class="modal-backdrop" x-show="modal === 'createProject'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-2">
      <h3 id="modal-title-2">New checklist</h3>
      <div class="modal-body">
        <div class="form-group">
          <label>Name</label>
          <input type="text" x-model="createProjectForm.name" maxlength="100" @keyup.enter="createProject()" placeholder="Checklist name" />
        </div>
        <div class="form-group">
          <label>Project (optional)</label>
          <select x-model="createProjectForm.group_id">
            <option value="">No project</option>
            <template x-for="g in groups" :key="g.id"><option :value="g.id" x-text="g.name"></option></template>
          </select>
        </div>
        <div class="form-group">
          <label>Visibility</label>
          <select x-model="createProjectForm.visibility">
            <option value="private">Private (owner only)</option>
            <option value="public">Public (anyone with link)</option>
          </select>
        </div>
        <p class="error-msg" x-show="modalError" x-text="modalError"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="createProject()">Create</button>
      </div>
    </div>
  </div>

  <!-- Create / edit project (a group of checklists) -->
  <div class="modal-backdrop" x-show="modal === 'group'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-group">
      <h3 id="modal-title-group" x-text="groupForm.id ? 'Edit project' : 'New project'"></h3>
      <p class="modal-sub">A project keeps related checklists together.</p>
      <div class="modal-body">
        <div class="form-group">
          <label>Name</label>
          <input type="text" x-model="groupForm.name" maxlength="100" @keyup.enter="submitGroup()" placeholder="For example: Thesis, Trip planning" />
        </div>
        <div class="form-group">
          <label>Description (optional)</label>
          <textarea x-model="groupForm.description" maxlength="500" rows="2"></textarea>
        </div>
        <p class="error-msg" x-show="modalError" x-text="modalError"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitGroup()" x-text="groupForm.id ? 'Save' : 'Create'"></button>
      </div>
    </div>
  </div>

  <!-- Move a checklist to a project -->
  <div class="modal-backdrop" x-show="modal === 'moveChecklist'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-move">
      <h3 id="modal-title-move">Move to project</h3>
      <p class="modal-sub" x-text="moveTarget?.name"></p>
      <div class="modal-body">
        <div class="form-group">
          <label>Project</label>
          <select x-model="moveGroupId">
            <option value="">No project</option>
            <template x-for="g in groups" :key="g.id"><option :value="g.id" x-text="g.name"></option></template>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitMove()">Move</button>
      </div>
    </div>
  </div>

  <!-- Delete project (group) -->
  <div class="modal-backdrop" x-show="modal === 'deleteGroup'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-delgroup">
      <h3 id="modal-title-delgroup">Delete project?</h3>
      <p class="modal-sub" x-text="groupTarget?.name"></p>
      <p style="font-size:15px;color:var(--text-muted);margin-top:4px;">The checklists inside are kept and move to “No project”. This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-danger" @click="confirmDeleteGroup()">Delete</button>
      </div>
    </div>
  </div>

  <!-- Add item -->
  <div class="modal-backdrop" x-show="modal === 'addItem'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-3">
      <h3 id="modal-title-3">Add item</h3>
      <div class="modal-body">
        <div class="form-group">
          <label>Type</label>
          <select x-model="itemForm.item_type">
            <option value="task">Task</option>
            <option value="section">Section header</option>
          </select>
        </div>
        <div class="form-group">
          <label x-text="itemForm.item_type === 'section' ? 'Section title' : 'Title'"></label>
          <input type="text" x-model="itemForm.title" maxlength="200" @keyup.enter="submitItem()" :placeholder="itemForm.item_type === 'section' ? 'e.g. Phase 1 — Getting Started' : 'What needs to be done?'" />
        </div>
        <div class="form-group">
          <label x-text="itemForm.item_type === 'section' ? 'Caption (optional)' : 'Description (optional)'"></label>
          <textarea x-model="itemForm.description" maxlength="2000" rows="2" :placeholder="itemForm.item_type === 'section' ? 'Short description of this section...' : 'Details...'"></textarea>
        </div>
        <template x-if="!user">
          <div class="form-group">
            <label>Your name</label>
            <input type="text" x-model="itemForm.actor_name" maxlength="100" placeholder="Your name" />
          </div>
        </template>
        <p class="error-msg" x-show="modalError" x-text="modalError"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitItem()" x-text="itemForm.item_type === 'section' ? 'Add section' : 'Add task'"></button>
      </div>
    </div>
  </div>

  <!-- Edit item -->
  <div class="modal-backdrop" x-show="modal === 'editItem'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-4">
      <h3 id="modal-title-4">Edit item</h3>
      <div class="modal-body">
        <div class="form-group">
          <label>Title</label>
          <input type="text" x-model="itemForm.title" maxlength="200" @keyup.enter="submitItem()" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea x-model="itemForm.description" maxlength="2000" rows="3"></textarea>
        </div>
        <template x-if="!user">
          <div class="form-group">
            <label>Your name</label>
            <input type="text" x-model="itemForm.actor_name" maxlength="100" placeholder="Your name" />
          </div>
        </template>
        <p class="error-msg" x-show="modalError" x-text="modalError"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitItem()">Save</button>
      </div>
    </div>
  </div>

  <!-- Mark complete -->
  <div class="modal-backdrop" x-show="modal === 'complete'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-5">
      <h3 id="modal-title-5" x-text="completingItem?.completion ? 'Edit completion' : 'Mark as complete'"></h3>
      <p class="modal-sub" x-text="completingItem?.title"></p>
      <div class="form-group">
        <label>Completed by</label>
        <input type="text" x-model="completeForm.done_by_name" maxlength="100" @keyup.enter="submitComplete()" placeholder="Your name" />
      </div>
      <div class="form-group">
        <label>Notes (optional)</label>
        <textarea x-model="completeForm.notes" maxlength="2000" rows="2" placeholder="Any notes..."></textarea>
      </div>
      <p class="error-msg" x-show="modalError" x-text="modalError"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitComplete()" x-text="completingItem?.completion ? 'Save' : 'Complete'"></button>
      </div>
    </div>
  </div>

  <!-- Add PIC -->
  <div class="modal-backdrop" x-show="modal === 'addPic'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-6">
      <h3 id="modal-title-6">Add PIC</h3>
      <p class="modal-sub" x-text="picTargetItem?.title"></p>
      <div class="form-group">
        <label>Name</label>
        <input type="text" x-model="picForm.name" maxlength="100" @keyup.enter="submitPic()" placeholder="Person in charge" />
      </div>
      <template x-if="!user">
        <div class="form-group">
          <label>Assigned by</label>
          <input type="text" x-model="picForm.actor_name" maxlength="100" placeholder="Your name" />
        </div>
      </template>
      <p class="error-msg" x-show="modalError" x-text="modalError"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitPic()">Add</button>
      </div>
    </div>
  </div>

  <!-- Non-owner assign (PIC / complete) -->
  <div class="modal-backdrop" x-show="modal === 'nonOwnerAssign'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-7">
      <h3 id="modal-title-7" x-text="nonOwnerAssignMode === 'pic' ? 'Who is responsible?' : (nonOwnerAssignItem?.completion ? 'Edit completion' : 'Who completed this?')"></h3>
      <p class="modal-sub" x-text="nonOwnerAssignItem?.title?.slice(0, 60) + (nonOwnerAssignItem?.title?.length > 60 ? '...' : '')"></p>
      <div class="form-group">
        <label x-text="nonOwnerAssignMode === 'pic' ? 'Person in charge' : 'Your name'"></label>
        <input type="text" x-model="nonOwnerAssignInput" maxlength="100" @keyup.enter="submitNonOwnerAssign()" placeholder="Enter name..." />
      </div>
      <p class="error-msg" x-show="nonOwnerAssignError" x-text="nonOwnerAssignError"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-primary" @click="submitNonOwnerAssign()">Save</button>
      </div>
    </div>
  </div>

  <!-- Import / Markdown -->
  <div class="modal-backdrop" x-show="modal === 'import'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-8" style="max-width:460px;">
      <h3 id="modal-title-8">Import checklist</h3>
      <p class="modal-sub">Bulk-create tasks and sections from a file. Choose a format below.</p>
      <div class="modal-body">
        <div class="import-format-tabs">
          <button class="import-fmt-tab" :class="{ active: importTab === 'md' }" @click="importTab = 'md'">Markdown <span class="import-fmt-badge">Recommended</span></button>
          <button class="import-fmt-tab" :class="{ active: importTab === 'csv' }" @click="importTab = 'csv'">CSV</button>
        </div>
        <template x-if="importTab === 'md'">
          <div class="import-template-box">
            <div class="import-template-label">Format — .md file</div>
            <code>## Section title</code>
            <code class="dim">Optional section description</code>
            <code>&nbsp;</code>
            <code>- [ ] Task title</code>
            <code class="dim">&nbsp;&nbsp;Optional task description (indented)</code>
            <code>- [ ] Another task</code>
          </div>
        </template>
        <template x-if="importTab === 'csv'">
          <div class="import-template-box">
            <div class="import-template-label">Format — .csv file</div>
            <code>type,title,description</code>
            <code class="dim">section,Phase 1 — Getting Started,Overview</code>
            <code class="dim">task,Set up repository,Clone and configure</code>
            <code class="dim">task,Write tests,</code>
          </div>
        </template>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button class="btn btn-secondary" style="flex:1;" @click="downloadTemplate('md')"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg> Markdown template</button>
          <button class="btn btn-secondary" style="flex:1;" @click="downloadTemplate('csv')"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg> CSV template</button>
        </div>
        <label class="import-drop-zone" :class="{ loading: importLoading }">
          <div class="import-drop-icon"><svg class="icon" aria-hidden="true"><use href="#i-file"/></svg></div>
          <div class="import-drop-text" x-text="importLoading ? 'Importing…' : 'Click to choose a file'"></div>
          <div class="import-drop-hint">.md and .csv files accepted · format auto-detected</div>
          <input type="file" accept=".md,.markdown,.csv,text/csv,text/markdown,text/plain" style="display:none;" @change="handleImportFile($event)" :disabled="importLoading" />
        </label>
        <p class="error-msg" x-show="importError" x-text="importError" style="white-space:pre-wrap;margin-top:10px;"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Auth modal (shown to guests while viewing a project) -->
  <div class="modal-backdrop" x-show="modal === 'auth'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-9" style="max-width:360px;">
      <h3 id="modal-title-9" x-text="authMode === 'login' ? 'Sign in' : 'Create account'"></h3>
      <p class="modal-sub">Group Checklist</p>
      <div class="modal-body" style="padding-top:4px;">
        <div class="form-group">
          <label>Username</label>
          <input class="form-control" x-model="authForm.username" maxlength="32" @keyup.enter="submitAuth()" placeholder="Enter username" autocomplete="username" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input class="form-control" type="password" x-model="authForm.password" maxlength="128" @keyup.enter="submitAuth()" placeholder="Enter password" autocomplete="current-password" />
        </div>
        <p class="error-msg" x-show="authError" x-text="authError"></p>
        <button class="btn btn-primary btn-block" style="margin-top:4px;" @click="submitAuth()" :disabled="authLoading">
          <span x-text="authLoading ? 'Please wait...' : (authMode === 'login' ? 'Sign in' : 'Create account')"></span>
        </button>
        <p class="auth-switch" style="text-align:center;margin-top:10px;">
          <span x-show="authMode === 'login'">No account? <a @click="authMode='register'; authError=''">Register</a></span>
          <span x-show="authMode === 'register'">Already have one? <a @click="authMode='login'; authError=''">Sign in</a></span>
        </p>
      </div>
    </div>
  </div>

  <!-- Delete checklist -->
  <div class="modal-backdrop" x-show="modal === 'deleteProject'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-10">
      <h3 id="modal-title-10">Delete checklist?</h3>
      <p class="modal-sub" x-text="activeProject?.name"></p>
      <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">All items, completions, and logs will be permanently deleted. This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-danger" @click="confirmDeleteProject()">Delete</button>
      </div>
    </div>
  </div>

  <!-- Delete item -->
  <div class="modal-backdrop" x-show="modal === 'deleteItem'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-11">
      <h3 id="modal-title-11">Delete item?</h3>
      <p class="modal-sub" x-text="deleteItemTarget?.title?.slice(0,80)"></p>
      <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-danger" @click="confirmDeleteItem()">Delete</button>
      </div>
    </div>
  </div>

  <!-- Comment popup backdrop -->
  <div x-show="commentPopup.visible" style="position:fixed;inset:0;z-index:110;" @click="closeCommentPopup()"></div>

  <!-- Comment popup — :style uses object to avoid backtick nesting issues -->
  <div
    x-show="commentPopup.visible"
    class="comment-popup" role="dialog" aria-label="Comments"
    :style="{ top: commentPopup.top + 'px', left: commentPopup.left + 'px' }"
    @click.stop
  >
    <div class="comment-popup-header">
      <span class="comment-popup-title" x-text="commentPopup.item?.title?.slice(0,60)"></span>
      <button class="btn-link" @click="closeCommentPopup()" aria-label="Close comments" style="font-size:16px;line-height:1;padding:2px;"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>
    </div>
    <template x-if="commentPopup.item?.completion?.notes">
      <div class="comment-completion">
        <div class="comment-section-label">Completion note</div>
        <div class="comment-completion-text" x-text="commentPopup.item.completion.notes"></div>
      </div>
    </template>
    <div class="comment-list">
      <div class="comment-section-label">Comments</div>
      <div class="comment-loading" x-show="commentPopup.loading">Loading…</div>
      <div class="comment-empty" x-show="!commentPopup.loading && commentPopup.comments.length === 0">No comments yet.</div>
      <template x-for="c in commentPopup.comments" :key="c.id">
        <div class="comment-item">
          <div class="comment-item-meta">
            <span class="comment-author" x-text="c.author_name"></span>
            <span class="comment-time" x-text="new Date(c.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' · ' + new Date(c.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})"></span>
            <button x-show="user && c.author_name === user.username && (Date.now() - new Date(c.created_at).getTime()) < 300000" class="comment-delete-btn" @click.stop="deleteComment(c)" title="Delete comment">×</button>
          </div>
          <div class="comment-text" x-text="c.body"></div>
        </div>
      </template>
    </div>
    <template x-if="user">
      <div class="comment-add">
        <textarea class="comment-textarea" x-model="commentPopup.input" maxlength="2000" @keydown.meta.enter="addComment()" @keydown.ctrl.enter="addComment()" placeholder="Add a comment…" rows="2"></textarea>
        <button class="btn btn-primary" style="font-size:12px;padding:5px 12px;align-self:flex-end;" @click="addComment()" :disabled="!commentPopup.input.trim()">Comment</button>
      </div>
    </template>
    <div x-show="!user" class="comment-guest">
      <a @click="closeCommentPopup(); authMode='login'; openModal('auth');" style="color:var(--accent);cursor:pointer;">Sign in</a> to leave a comment. Guests can view only.
    </div>
  </div>

  <!-- Export -->
  <div class="modal-backdrop" x-show="modal === 'export'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-12" style="max-width:340px;">
      <h3 id="modal-title-12">Export checklist</h3>
      <p class="modal-sub" x-text="activeProject?.name"></p>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:10px;">
        <button class="export-format-btn" @click="exportChecklist('md')">
          <div class="export-fmt-title">Markdown <span class="import-fmt-badge">Recommended</span></div>
          <div class="export-fmt-desc">Sections, tasks, completion info</div>
        </button>
        <button class="export-format-btn" @click="exportChecklist('csv')">
          <div class="export-fmt-title">CSV spreadsheet</div>
          <div class="export-fmt-desc">All fields including PICs and dates</div>
        </button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Batch delete confirmation -->
  <div class="modal-backdrop" x-show="modal === 'batchDelete'" @click.self="closeModal()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-13">
      <h3 id="modal-title-13">Delete selected items?</h3>
      <p class="modal-sub" x-text="selectedCount() + ' item' + (selectedCount() !== 1 ? 's' : '') + ' will be permanently deleted.'"></p>
      <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="closeModal()">Cancel</button>
        <button class="btn btn-danger" @click="confirmBatchDelete()">Delete</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" :class="toast.type" x-show="toast.visible" role="status" aria-live="polite"
       @mouseenter="pauseToast()" @mouseleave="resumeToast()" @focusin="pauseToast()" @focusout="resumeToast()">
    <span x-text="toast.msg"></span>
    <button type="button" class="toast-action" x-show="toast.action" x-text="toast.action?.label" @click="runToastAction()"></button>
  </div>

`;
