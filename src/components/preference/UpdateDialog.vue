<script setup lang="ts">
/** @fileoverview Placeholder update dialog — updater feature removed. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NButton, NText } from 'naive-ui'

const { t } = useI18n()
const visible = ref(false)

function open() {
  visible.value = true
}

function close() {
  visible.value = false
}

defineExpose({ open, close })
</script>

<template>
  <NModal v-model:show="visible" :mask-closable="true" :close-on-esc="true" transform-origin="center">
    <div class="update-placeholder">
      <NText tag="p" style="font-size: 14px">
        自动更新功能已禁用。
      </NText>
      <NButton type="primary" size="small" @click="close" style="margin-top: 12px">
        关闭
      </NButton>
    </div>
  </NModal>
</template>

<style scoped>
.update-placeholder {
  background: var(--n-color, #fff);
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  min-width: 300px;
  max-width: 400px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}
</style>
