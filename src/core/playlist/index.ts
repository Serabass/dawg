import Vue from 'vue';
import * as t from '@/lib/io';
import { project } from '@/core/project';
// FIXME(2) Remove this import
import { record } from '@/core/record';
import { PlaylistElements } from '@/models';
import { ref } from '@vue/composition-api';
import * as framework from '@/lib/framework';
import { Ghost } from '@/models/ghost';
import { controls } from '@/core/controls';
import { log } from '@/core/log';
import { sampleViewer } from '@/core/sample-viewer';
import { patterns } from '@/core/patterns';
import { SequencerTool } from '@/grid';

export const playlist = framework.manager.activate({
  id: 'dawg.playlist',
  workspace: {
    playlistRowHeight: {
      type: t.number,
      default: 40,
    },
    playlistBeatWidth: {
      type: t.number,
      default: 80,
    },
    tool: t.union([t.literal('slicer'), t.literal('pointer')]),
  },
  activate(context) {
    // Do not remove, for type checking
    const tool: SequencerTool | undefined = context.workspace.tool.value;

    const masterStart = ref(0);
    const masterEnd = ref(0);
    const ghosts: Ghost[] = [];

    const playlistRowHeight = context.workspace.playlistRowHeight;
    const playlistBeatWidth = context.workspace.playlistBeatWidth;
    const logger = log.getLogger();

    const component = Vue.extend({
      name: 'PlaylistSequencerWrapper',
      template: `
      <playlist-sequencer
        :tracks="project.tracks"
        :sequence="project.master.elements"
        :transport="project.master.transport"
        :play="playlistPlay"
        :start.sync="masterStart.value"
        :end.sync="masterEnd.value"
        :steps-per-beat="project.stepsPerBeat"
        :beats-per-measure="project.beatsPerMeasure"
        :row-height.sync="playlistRowHeight.value"
        :px-per-beat.sync="playlistBeatWidth.value"
        :is-recording="recording.value"
        :ghosts="ghosts"
        @new-prototype="checkPrototype"
        @open="open"
        :tool.sync="tool.value"
      ></playlist-sequencer>
      `,
      data: () => ({
        recording: record.recording,

        // We need these to be able to keep track of the start and end of the playlist loop
        // for creating automation clips
        masterStart,
        masterEnd,
        ghosts,
        project,
        playlistRowHeight,
        playlistBeatWidth,
        tool: context.workspace.tool,
      }),
      computed: {
        playlistPlay() {
          return controls.state.value === 'started' && controls.context.value === 'playlist';
        },
      },
      methods: {
        /**
         * Whenever we add a sample, if it hasn't been imported before, add it the the list of project samples.
         */
        checkPrototype(prototype: PlaylistElements) {
          if (prototype.type !== 'sample') {
            return;
          }

          const sample = prototype.element;
          if (project.samples.indexOf(prototype.element) >= 0) {
            return;
          }

          logger.debug('Adding a sample!');
          project.addSample(sample);
        },
        open(element: PlaylistElements) {
          switch (element.type) {
            case 'sample':
              sampleViewer.openedSample.value = element.element;
              break;
            case 'pattern':
              patterns.selectedPattern.value = element.element;
              break;
          }
        },
      },
    });

    framework.ui.mainSection.push(component);

    return {
      masterStart,
      masterEnd,
      ghosts,
      playlistRowHeight,
      playlistBeatWidth,
    };
  },
});